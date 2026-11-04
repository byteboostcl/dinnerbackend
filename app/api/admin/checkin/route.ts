import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check-in en puerta.
 *
 * POST marca llegada y DELETE la deshace. Los dos aceptan lo mismo:
 * - `qrToken`: un boleto concreto (lo que lee el escáner).
 * - `code` (+ `quantity`): la reserva completa, para cuando alguien dicta el
 *   código por teléfono o el QR no se lee. Se marcan `quantity` boletos
 *   pendientes (por omisión 1: marcar de más es peor que marcar de menos,
 *   porque deja a alguien "abordado" que no ha llegado).
 *
 * Quién marca sale SIEMPRE de requireStaff, nunca del body: el registro de
 * quién dejó pasar a quién no debe poder falsearse desde el cliente.
 */

type CheckinInput = {
  qrToken?: unknown;
  code?: unknown;
  quantity?: unknown;
  passengerName?: unknown;
};

const BOOKING_INCLUDE = {
  tickets: { orderBy: { createdAt: 'asc' as const } },
  flight: {
    select: {
      startsAt: true,
      status: true,
      experience: { select: { season: { select: { timezone: true } } } }
    }
  }
};

async function loadBookingByWhere(where: { code: string } | { id: string }) {
  return prisma.booking.findUnique({ where, include: BOOKING_INCLUDE });
}

type LoadedBooking = NonNullable<Awaited<ReturnType<typeof loadBookingByWhere>>>;

const STATUS_MESSAGE: Record<string, string> = {
  CANCELLED: 'Esta reserva está CANCELADA. No puede pasar.',
  REFUNDED: 'Esta reserva fue REEMBOLSADA. No puede pasar.',
  PENDING: 'Esta reserva tiene el pago PENDIENTE: no está confirmada. No puede pasar.',
  EXPIRED: 'Esta reserva EXPIRÓ sin pago. No puede pasar.'
};

function fail(status: number, error: string, extra?: Record<string, unknown>): Response {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/** El código se dicta por teléfono: tolera minúsculas, espacios y que falte el "DITS-". */
function normalizeCode(raw: string): string {
  const clean = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{6}$/.test(clean) ? `DITS-${clean}` : clean;
}

function formatLocal(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

/** Lo que quien está en puerta necesita ver después de cada acción. */
async function buildContext(bookingId: string) {
  const booking = await loadBookingByWhere({ id: bookingId });
  if (!booking) return null;

  const checkedIn = booking.tickets.filter(ticket => ticket.checkedInAt !== null).length;
  const timezone = booking.flight.experience.season.timezone;

  return {
    code: booking.code,
    customerName: booking.customerName,
    bookingStatus: booking.status,
    seats: booking.seats,
    checkedIn,
    pending: booking.tickets.length - checkedIn,
    flight: {
      startsAt: booking.flight.startsAt.toISOString(),
      startsAtLocal: formatLocal(booking.flight.startsAt, timezone),
      status: booking.flight.status
    },
    // Un vuelo cancelado con reserva confirmada es un caso que el equipo debe
    // resolver a mano; aquí solo se avisa, no se bloquea el check-in.
    warning:
      booking.flight.status === 'CANCELLED'
        ? 'El vuelo de esta reserva está CANCELADO. Confirma con el equipo antes de dejar pasar.'
        : null,
    tickets: booking.tickets.map(ticket => ({
      id: ticket.id,
      passengerName: ticket.passengerName,
      checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
      checkedInBy: ticket.checkedInBy
    }))
  };
}

type Resolved =
  | { error: Response }
  | { booking: LoadedBooking; ticketId: string | null; input: CheckinInput };

/** Interpreta el body y encuentra la reserva (y el boleto, si vino un QR). */
async function resolveTarget(request: Request): Promise<Resolved> {
  let input: CheckinInput;
  try {
    input = await request.json();
  } catch {
    return { error: fail(400, 'Body inválido, se esperaba JSON.') };
  }

  const qrToken = typeof input.qrToken === 'string' ? input.qrToken.trim() : '';
  const code = typeof input.code === 'string' ? normalizeCode(input.code) : '';

  if (!qrToken && !code) {
    return { error: fail(400, 'Indica qrToken o code.') };
  }

  if (qrToken) {
    const ticket = await prisma.ticket.findUnique({ where: { qrToken }, select: { id: true, bookingId: true } });
    if (!ticket) return { error: fail(404, 'No existe un boleto con ese QR.') };
    const booking = await loadBookingByWhere({ id: ticket.bookingId });
    if (!booking) return { error: fail(404, 'No existe la reserva de ese boleto.') };
    return { booking, ticketId: ticket.id, input };
  }

  const booking = await loadBookingByWhere({ code });
  if (!booking) return { error: fail(404, `No existe una reserva con el código ${code}.`) };
  return { booking, ticketId: null, input };
}

function readQuantity(raw: unknown): number | null {
  if (raw === undefined) return 1;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : null;
}

/** POST /api/admin/checkin — marcar llegada. Idempotente. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const resolved = await resolveTarget(request);
  if ('error' in resolved) return resolved.error;
  const { booking, ticketId, input } = resolved;

  // Cancelar hoy no invalida los boletos: esta es la única barrera que
  // impide que un boleto cancelado o reembolsado entre en puerta.
  if (booking.status !== 'CONFIRMED') {
    return fail(409, STATUS_MESSAGE[booking.status] ?? `La reserva está ${booking.status}. No puede pasar.`, {
      notConfirmed: true,
      context: await buildContext(booking.id)
    });
  }

  if (booking.tickets.length === 0) {
    return fail(409, 'La reserva está confirmada pero no tiene boletos generados. Avisa a administración.');
  }

  let passengerName: string | null = null;
  if (input.passengerName !== undefined && input.passengerName !== null) {
    if (typeof input.passengerName !== 'string') {
      return fail(400, 'passengerName debe ser texto.');
    }
    passengerName = input.passengerName.trim().slice(0, 120) || null;
  }

  const pending = booking.tickets.filter(ticket => ticket.checkedInAt === null);
  let targets: LoadedBooking['tickets'];

  if (ticketId) {
    const ticket = booking.tickets.find(item => item.id === ticketId);
    if (!ticket) return fail(404, 'El boleto no pertenece a la reserva.');
    targets = ticket.checkedInAt === null ? [ticket] : [];
  } else {
    const quantity = readQuantity(input.quantity);
    if (quantity === null) return fail(400, 'quantity debe ser un entero mayor que cero.');
    if (pending.length > 0 && quantity > pending.length) {
      return fail(409, `Solo quedan ${pending.length} boleto(s) por marcar en esta reserva; se pidieron ${quantity}.`, {
        context: await buildContext(booking.id)
      });
    }
    targets = pending.slice(0, quantity);
  }

  if (passengerName && targets.length > 1) {
    return fail(400, 'passengerName solo aplica al marcar un boleto a la vez.');
  }

  let marked = 0;
  if (targets.length > 0) {
    // El filtro checkedInAt: null hace atómico el "primero que llega gana":
    // si dos teléfonos escanean el mismo boleto a la vez, uno marca y el otro
    // cae en la rama idempotente en lugar de pisar quién lo dejó pasar.
    const result = await prisma.ticket.updateMany({
      where: { id: { in: targets.map(ticket => ticket.id) }, checkedInAt: null },
      data: {
        checkedInAt: new Date(),
        checkedInBy: auth.actor,
        ...(passengerName ? { passengerName } : {})
      }
    });
    marked = result.count;
  }

  const context = await buildContext(booking.id);
  if (!context) return fail(404, 'La reserva ya no existe.');

  if (marked === 0) {
    // Nada nuevo que marcar: se responde ok con quién y cuándo lo hizo.
    const requested = ticketId ? context.tickets.find(ticket => ticket.id === ticketId) : undefined;
    const latest =
      requested ??
      [...context.tickets]
        .filter(ticket => ticket.checkedInAt !== null)
        .sort((a, b) => String(b.checkedInAt).localeCompare(String(a.checkedInAt)))[0];

    const when = latest?.checkedInAt
      ? formatLocal(new Date(latest.checkedInAt), booking.flight.experience.season.timezone)
      : null;

    return NextResponse.json({
      ok: true,
      alreadyCheckedIn: true,
      marked: 0,
      message: latest?.checkedInAt
        ? `Ya tenía check-in (${when}, por ${latest.checkedInBy ?? 'desconocido'}).`
        : 'Ya tenía check-in.',
      checkedInAt: latest?.checkedInAt ?? null,
      checkedInBy: latest?.checkedInBy ?? null,
      ...context
    });
  }

  return NextResponse.json({
    ok: true,
    alreadyCheckedIn: false,
    marked,
    message: `Check-in registrado: ${marked} boleto(s). Van ${context.checkedIn} de ${context.seats}.`,
    ...context
  });
}

/**
 * DELETE /api/admin/checkin — deshacer un check-in hecho por error.
 *
 * Es lo único reversible por diseño: en puerta se equivocan y no puede ser
 * un error sin vuelta. Limpia checkedInAt y checkedInBy; el nombre capturado
 * se conserva porque corregir un dedazo no debería obligar a reescribirlo.
 * Por código se deshacen los últimos marcados, que es lo que se acaba de
 * hacer mal.
 */
export async function DELETE(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const resolved = await resolveTarget(request);
  if ('error' in resolved) return resolved.error;
  const { booking, ticketId, input } = resolved;

  const checked = booking.tickets.filter(ticket => ticket.checkedInAt !== null);
  let targets: LoadedBooking['tickets'];

  if (ticketId) {
    targets = checked.filter(ticket => ticket.id === ticketId);
  } else {
    const quantity = readQuantity(input.quantity);
    if (quantity === null) return fail(400, 'quantity debe ser un entero mayor que cero.');
    if (checked.length > 0 && quantity > checked.length) {
      return fail(409, `Solo hay ${checked.length} check-in(s) para deshacer en esta reserva; se pidieron ${quantity}.`, {
        context: await buildContext(booking.id)
      });
    }
    targets = [...checked]
      .sort((a, b) => (b.checkedInAt?.getTime() ?? 0) - (a.checkedInAt?.getTime() ?? 0))
      .slice(0, quantity);
  }

  let undone = 0;
  if (targets.length > 0) {
    const result = await prisma.ticket.updateMany({
      where: { id: { in: targets.map(ticket => ticket.id) }, checkedInAt: { not: null } },
      data: { checkedInAt: null, checkedInBy: null }
    });
    undone = result.count;
  }

  const context = await buildContext(booking.id);
  if (!context) return fail(404, 'La reserva ya no existe.');

  return NextResponse.json({
    ok: true,
    undone,
    message:
      undone === 0
        ? 'No había check-in que deshacer.'
        : `Check-in deshecho: ${undone} boleto(s). Van ${context.checkedIn} de ${context.seats}.`,
    ...context
  });
}
