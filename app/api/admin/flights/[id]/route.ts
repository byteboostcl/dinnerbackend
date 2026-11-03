import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkApiKey } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PatchInput = {
  status?: unknown;
  capacity?: unknown;
  staffNote?: unknown;
};

const VALID_STATUS = ['SCHEDULED', 'CLOSED', 'CANCELLED'] as const;
type FlightStatusValue = (typeof VALID_STATUS)[number];

/**
 * PATCH /api/admin/flights/:id — abrir, cerrar o ajustar un vuelo.
 *
 * Es la operación que hoy Joan tiene que pedirle a TuriTop: cerrar la venta
 * de un horario por clima, por un privado o porque se agotó por otro canal.
 *
 * Dos reglas que protegen al cliente que ya pagó:
 * - La capacidad no puede bajar de los lugares ya comprometidos.
 * - Cancelar un vuelo con reservas confirmadas no las cancela solo: deja el
 *   vuelo marcado y la respuesta dice a cuántas personas hay que reubicar o
 *   reembolsar. Mover dinero ajeno nunca debe ser un efecto secundario.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authError = checkApiKey(request);
  if (authError) {
    return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  }

  const { id } = await context.params;

  let body: PatchInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const flight = await prisma.flight.findUnique({ where: { id } });
  if (!flight) {
    return NextResponse.json({ ok: false, error: 'El vuelo no existe.' }, { status: 404 });
  }

  const data: { status?: FlightStatusValue; capacity?: number; staffNote?: string | null } = {};

  if (body.status !== undefined) {
    const status = String(body.status).toUpperCase();
    if (!VALID_STATUS.includes(status as FlightStatusValue)) {
      return NextResponse.json(
        { ok: false, error: `status debe ser uno de: ${VALID_STATUS.join(', ')}.` },
        { status: 400 }
      );
    }
    data.status = status as FlightStatusValue;
  }

  if (body.capacity !== undefined) {
    const capacity = body.capacity;
    if (!Number.isInteger(capacity) || (capacity as number) <= 0) {
      return NextResponse.json({ ok: false, error: 'capacity debe ser un entero mayor que cero.' }, { status: 400 });
    }
    if ((capacity as number) < flight.seatsTaken) {
      return NextResponse.json(
        {
          ok: false,
          error: `No se puede dejar la capacidad en ${capacity}: el vuelo ya tiene ${flight.seatsTaken} lugares comprometidos.`
        },
        { status: 409 }
      );
    }
    data.capacity = capacity as number;
  }

  if (body.staffNote !== undefined) {
    data.staffNote = typeof body.staffNote === 'string' && body.staffNote.trim() ? body.staffNote.trim() : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: 'No hay nada que cambiar.' }, { status: 400 });
  }

  const updated = await prisma.flight.update({ where: { id }, data });

  // Aviso, no bloqueo: si se cancela o cierra un vuelo con gente dentro, el
  // panel tiene que decirlo con todas sus letras.
  let affectedBookings = 0;
  if (data.status === 'CANCELLED' || data.status === 'CLOSED') {
    affectedBookings = await prisma.booking.count({
      where: { flightId: id, status: 'CONFIRMED' }
    });
  }

  return NextResponse.json({
    ok: true,
    flight: { ...updated, seatsLeft: Math.max(0, updated.capacity - updated.seatsTaken) },
    affectedBookings,
    warning:
      affectedBookings > 0
        ? `Este vuelo tiene ${affectedBookings} reserva(s) confirmada(s). Hay que reubicarlas o reembolsarlas a mano: el cambio de estado no las toca.`
        : null
  });
}
