import { NextResponse } from 'next/server';
import { holdSeats, HOLD_MINUTES, type HoldLine } from '@/lib/booking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/booking/hold — aparta lugares y crea la reserva pendiente de pago.
 *
 * Es público: lo llama el sitio antes de mandar a pagar. No cobra nada; solo
 * guarda los lugares durante unos minutos para que nadie los compre mientras
 * la persona llena la tarjeta.
 */

const MAX_SEATS = 22;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const flightId = typeof body['flightId'] === 'string' ? body['flightId'].trim() : '';

  // Compatibilidad: si llega `seats` sin líneas, se interpreta como la
  // cantidad del ticket base. Así el sitio puede migrar sin romperse.
  const rawLines = Array.isArray(body['lines']) ? body['lines'] : [];
  const lines: HoldLine[] = rawLines
    .filter((l): l is { ticketTypeId: string; quantity: number } =>
      typeof l === 'object' && l !== null &&
      typeof (l as { ticketTypeId?: unknown }).ticketTypeId === 'string' &&
      Number.isInteger((l as { quantity?: unknown }).quantity))
    .map(l => ({ ticketTypeId: l.ticketTypeId, quantity: l.quantity }));

  const seats = lines.reduce((total, l) => total + l.quantity, 0);
  const customerName = typeof body['customerName'] === 'string' ? body['customerName'].trim() : '';
  const customerEmail = typeof body['customerEmail'] === 'string' ? body['customerEmail'].trim().toLowerCase() : '';
  const customerPhone = typeof body['customerPhone'] === 'string' ? body['customerPhone'].trim() : null;

  if (!flightId || !customerName || !EMAIL.test(customerEmail)) {
    return NextResponse.json(
      { ok: false, error: 'Faltan datos: horario, nombre y un correo válido.' },
      { status: 400 }
    );
  }

  if (lines.length === 0) {
    return NextResponse.json({ ok: false, error: 'No elegiste ningún boleto.' }, { status: 400 });
  }

  if (seats < 1 || seats > MAX_SEATS) {
    return NextResponse.json(
      { ok: false, error: `El número de boletos debe estar entre 1 y ${MAX_SEATS}.` },
      { status: 400 }
    );
  }

  const result = await holdSeats({
    flightId,
    lines,
    customerName,
    customerEmail,
    customerPhone,
    invoiceRequested: body['invoiceRequested'] === true,
    promoCode: typeof body['promoCode'] === 'string' ? body['promoCode'] : null
  });

  if (!result.ok) {
    // 409: el conflicto es de estado (se acabaron los lugares), no un error
    // de quien llama.
    const status = result.reason === 'FLIGHT_NOT_FOUND'
      ? 404
      : result.reason === 'EMPTY_CART' || result.reason === 'BAD_TICKET' || result.reason === 'LIMIT'
        ? 400
        : 409;
    return NextResponse.json({ ok: false, error: result.message, reason: result.reason }, { status });
  }

  return NextResponse.json({
    ok: true,
    booking: {
      id: result.bookingId,
      code: result.code,
      amountCents: result.amountCents,
      subtotalCents: result.subtotalCents,
      discountCents: result.discountCents,
      promoCode: result.promoCode,
      currency: result.currency,
      holdExpiresAt: result.holdExpiresAt,
      holdMinutes: HOLD_MINUTES
    }
  }, { status: 201 });
}
