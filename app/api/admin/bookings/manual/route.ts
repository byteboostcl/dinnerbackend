import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';
import { confirmBooking, holdSeats, type HoldLine } from '@/lib/booking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/bookings/manual — captura una venta hecha por teléfono,
 * WhatsApp o en sitio y la deja CONFIRMED con sus boletos emitidos.
 *
 * Existe para que el equipo no tenga que volver a TuriTop cada vez que cierra
 * una venta fuera de la web. No cobra nada: el pago ocurrió por otra vía y se
 * documenta en `paymentNote`.
 *
 * No hay lógica propia de asientos ni de precios. Se reutiliza `holdSeats`
 * (conteo atómico, precios leídos de la base, límites por tipo de boleto,
 * descuento) y `confirmBooking` (boletos y canje del código). Duplicarlos
 * abriría la puerta a que una venta de mostrador y una web se pisen el mismo
 * último lugar.
 *
 * Limitación conocida: `sendEmail` se acepta pero NO tiene efecto.
 * `confirmBooking` manda siempre el correo de confirmación y no ofrece forma
 * de omitirlo; evitarlo desde aquí exigiría duplicar su lógica o modificar
 * lib/booking.ts. Mientras eso no cambie, el correo sale aunque se pida
 * `sendEmail: false`, y la respuesta lo advierte en `warnings`.
 */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(request: Request): Promise<Response> {
  // Primero la autorización, antes de leer el body: sin sesión ni API key no
  // se revela nada sobre qué datos espera el endpoint.
  const staff = await requireStaff(request);
  if ('error' in staff) {
    return NextResponse.json({ ok: false, error: staff.error }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const flightId = typeof body['flightId'] === 'string' ? body['flightId'].trim() : '';
  const customerName = typeof body['customerName'] === 'string' ? body['customerName'].trim() : '';
  const customerEmail = typeof body['customerEmail'] === 'string' ? body['customerEmail'].trim().toLowerCase() : '';
  const customerPhone = typeof body['customerPhone'] === 'string' && body['customerPhone'].trim()
    ? body['customerPhone'].trim()
    : null;
  const promoCode = typeof body['promoCode'] === 'string' && body['promoCode'].trim()
    ? body['promoCode'].trim()
    : null;
  const paymentNote = typeof body['paymentNote'] === 'string' ? body['paymentNote'].trim() : '';

  if (!flightId || !customerName || !EMAIL.test(customerEmail)) {
    return NextResponse.json(
      { ok: false, error: 'Faltan datos: horario, nombre y un correo válido.' },
      { status: 400 }
    );
  }

  // Sin esta nota, meses después nadie puede explicar una reserva que no
  // tiene pago en Stripe. Por eso se exige y no se rellena con un valor por
  // defecto.
  if (!paymentNote) {
    return NextResponse.json(
      { ok: false, error: 'Indica cómo se cobró (por ejemplo: transferencia, efectivo en sitio, cortesía de prensa).' },
      { status: 400 }
    );
  }

  const rawLines = Array.isArray(body['lines']) ? body['lines'] : [];
  const lines: HoldLine[] = [];
  for (const raw of rawLines) {
    const line = raw as { ticketTypeId?: unknown; quantity?: unknown } | null;
    if (
      typeof line !== 'object' || line === null ||
      typeof line.ticketTypeId !== 'string' ||
      typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity <= 0
    ) {
      // holdSeats ignora en silencio las líneas con cantidad inválida; aquí se
      // rechaza para que una captura mal hecha no salga con menos boletos de
      // los que la persona creyó registrar.
      return NextResponse.json(
        { ok: false, error: 'Cada boleto necesita un tipo y una cantidad entera mayor a cero.' },
        { status: 400 }
      );
    }
    lines.push({ ticketTypeId: line.ticketTypeId, quantity: line.quantity });
  }

  if (lines.length === 0) {
    return NextResponse.json({ ok: false, error: 'No elegiste ningún boleto.' }, { status: 400 });
  }

  const hold = await holdSeats({ flightId, lines, customerName, customerEmail, customerPhone, promoCode });

  if (!hold.ok) {
    // Mismo reparto de códigos que el apartado público; el mensaje de
    // holdSeats ("Ya no quedan suficientes lugares…") se propaga tal cual
    // porque es el que le sirve a quien captura.
    const status = hold.reason === 'FLIGHT_NOT_FOUND'
      ? 404
      : hold.reason === 'EMPTY_CART' || hold.reason === 'BAD_TICKET' || hold.reason === 'LIMIT'
        ? 400
        : 409;
    return NextResponse.json({ ok: false, error: hold.message, reason: hold.reason }, { status });
  }

  // holdSeats no permite fijar el canal ni las notas: siempre crea la reserva
  // como 'web'. Se corrigen aquí, ANTES de confirmar, para que la reserva no
  // pueda quedar confirmada sin su registro de quién la capturó y cómo se
  // cobró. Fechas en UTC (toISOString) como en el resto del sistema.
  const internalNotes =
    `Captura manual por ${staff.actor} el ${new Date().toISOString()} (UTC). Cobro: ${paymentNote}`;

  try {
    await prisma.booking.update({
      where: { id: hold.bookingId },
      data: { channel: 'staff', internalNotes }
    });
  } catch (error) {
    // Los lugares quedan apartados pero la reserva sigue PENDING: el apartado
    // vence solo y los libera, así que no hace falta deshacer nada a mano.
    console.error(`[booking] ${hold.code}: no se pudo marcar como venta de staff`, error);
    return NextResponse.json(
      { ok: false, error: 'No se pudo registrar la reserva. No se emitió ningún boleto; intenta de nuevo.' },
      { status: 500 }
    );
  }

  const confirmation = await confirmBooking(hold.bookingId);

  if (!confirmation.ok) {
    // La reserva con su código existe y sus lugares siguen apartados hasta
    // que venza el apartado. Se da el código para que el equipo pueda
    // localizarla en el panel en vez de capturarla dos veces.
    console.error(`[booking] ${hold.code}: no se pudo confirmar la captura manual: ${confirmation.message}`);
    return NextResponse.json(
      {
        ok: false,
        error: `La reserva ${hold.code} se creó pero no se pudo confirmar: ${confirmation.message}`,
        code: hold.code
      },
      { status: 500 }
    );
  }

  const warnings: string[] = [];

  // holdSeats cobra el precio completo cuando el código no aplica (vencido,
  // agotado, con otra vigencia). Para una venta de mostrador eso es un cobro
  // distinto al que se prometió por teléfono, así que se avisa en vez de
  // dejarlo pasar en silencio.
  if (promoCode && hold.promoCode === null) {
    warnings.push(`El código "${promoCode}" no se pudo aplicar y se registró el precio completo.`);
  }

  if (body['sendEmail'] === false) {
    warnings.push('El correo de confirmación se envió de todos modos: el sistema aún no permite omitirlo.');
  }

  const booking = await prisma.booking.findUnique({
    where: { id: hold.bookingId },
    select: {
      id: true,
      code: true,
      status: true,
      channel: true,
      flightId: true,
      seats: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      amountCents: true,
      subtotalCents: true,
      discountCents: true,
      promoCodeUsed: true,
      currency: true,
      internalNotes: true,
      confirmedAt: true,
      items: {
        select: { nameAtPurchase: true, unitPriceCents: true, quantity: true, seats: true }
      },
      tickets: { select: { id: true } }
    }
  });

  if (!booking) {
    return NextResponse.json(
      { ok: false, error: `La reserva ${hold.code} se confirmó, pero no se pudo leer de nuevo.`, code: hold.code },
      { status: 500 }
    );
  }

  const { tickets, ...rest } = booking;

  return NextResponse.json(
    { ok: true, booking: { ...rest, ticketCount: tickets.length }, warnings },
    { status: 201 }
  );
}
