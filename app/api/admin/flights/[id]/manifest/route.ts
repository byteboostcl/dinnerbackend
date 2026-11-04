import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/flights/:id/manifest — la lista de puerta de un vuelo.
 *
 * Es lo que el equipo consulta la noche del vuelo para saber quién tiene
 * lugar y quién ya llegó. Por eso:
 * - Los conteos salen SOLO de reservas CONFIRMED. Una pendiente puede expirar
 *   y una cancelada o reembolsada ya no tiene derecho a entrar; contarlas
 *   infla "faltan" y manda al equipo a buscar a gente que no viene.
 * - Las no confirmadas se devuelven aparte y sin preferencias, para poder
 *   explicarle a quien llega con un boleto invalidado por qué no pasa.
 *
 * Aquí viajan las alergias (datos de salud). Existen para que la cocina no
 * mande un plato que hospitalice a alguien, y el equipo las necesita en
 * puerta; por eso este endpoint exige sesión y no debe copiarse a ninguna
 * ruta pública.
 */

type Preferences = {
  menu: string | null;
  allergies: string | null;
  celebration: string | null;
};

/**
 * `preferences` es JSON libre que escribe el cliente después de pagar. Se
 * lee defensivamente: un valor mal formado no debe tumbar la lista completa
 * en el momento en que más se necesita.
 */
function readPreferences(value: unknown): Preferences | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string): string | null => {
    const item = raw[key];
    return typeof item === 'string' && item.trim() ? item.trim() : null;
  };
  return { menu: text('menu'), allergies: text('allergies'), celebration: text('celebration') };
}

/** Fecha y hora legibles en la zona de la sede, p. ej. "vie 14 nov, 19:30". */
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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id } = await context.params;

  const flight = await prisma.flight.findUnique({
    where: { id },
    include: {
      experience: {
        select: { id: true, name: true, season: { select: { id: true, name: true, timezone: true } } }
      }
    }
  });
  if (!flight) {
    return NextResponse.json({ ok: false, error: 'El vuelo no existe.' }, { status: 404 });
  }

  const timezone = flight.experience.season.timezone;

  const bookings = await prisma.booking.findMany({
    where: { flightId: id },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      tickets: { orderBy: { createdAt: 'asc' } }
    }
  });

  // El orden alfabético se hace aquí y no en la base: la collation de
  // Postgres puede ordenar mal acentos y la "ñ", y en una lista impresa
  // "Álvarez" debe quedar junto a la A.
  const byName = (a: { customerName: string }, b: { customerName: string }) =>
    a.customerName.localeCompare(b.customerName, 'es', { sensitivity: 'base' });

  const confirmed = bookings.filter(booking => booking.status === 'CONFIRMED').sort(byName);
  const notConfirmed = bookings.filter(booking => booking.status !== 'CONFIRMED').sort(byName);

  const entries = confirmed.map(booking => {
    const checkedIn = booking.tickets.filter(ticket => ticket.checkedInAt !== null).length;
    return {
      id: booking.id,
      code: booking.code,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
      seats: booking.seats,
      items: booking.items.map(item => ({
        name: item.nameAtPurchase,
        quantity: item.quantity,
        seats: item.seats
      })),
      preferences: readPreferences(booking.preferences),
      internalNotes: booking.internalNotes,
      invoiceRequested: booking.invoiceRequested,
      checkedIn,
      pending: booking.tickets.length - checkedIn,
      tickets: booking.tickets.map(ticket => ({
        id: ticket.id,
        passengerName: ticket.passengerName,
        checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
        checkedInBy: ticket.checkedInBy
      }))
    };
  });

  const totalSeats = confirmed.reduce((sum, booking) => sum + booking.seats, 0);
  const checkedInSeats = entries.reduce((sum, entry) => sum + entry.checkedIn, 0);

  return NextResponse.json({
    ok: true,
    flight: {
      id: flight.id,
      status: flight.status,
      startsAt: flight.startsAt.toISOString(),
      startsAtLocal: formatLocal(flight.startsAt, timezone),
      timezone,
      capacity: flight.capacity,
      // seatsTaken incluye apartados sin pagar, por eso puede ser mayor que
      // totalSeats del resumen: el resumen solo cuenta a quien ya pagó.
      seatsTaken: flight.seatsTaken,
      experience: flight.experience.name,
      season: flight.experience.season.name
    },
    summary: {
      bookings: confirmed.length,
      totalSeats,
      checkedIn: checkedInSeats,
      remaining: totalSeats - checkedInSeats
    },
    bookings: entries,
    notConfirmed: notConfirmed.map(booking => ({
      code: booking.code,
      customerName: booking.customerName,
      seats: booking.seats,
      status: booking.status,
      cancelReason: booking.cancelReason
    }))
  });
}
