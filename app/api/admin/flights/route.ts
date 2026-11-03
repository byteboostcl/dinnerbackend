import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkApiKey } from '@/lib/auth';
import { zonedTimeToUtc, zonedWeekday } from '@/lib/timezone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vuelos de una experiencia.
 *
 * El alta es masiva a propósito: una temporada son tres semanas por cuatro
 * horarios, del orden de ochenta vuelos. Pedirle al staff que los cree uno a
 * uno garantiza erratas y abandono del panel.
 */

/** GET /api/admin/flights?experienceId=...  — con ocupación de cada vuelo. */
export async function GET(request: Request): Promise<Response> {
  const authError = checkApiKey(request);
  if (authError) {
    return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const experienceId = searchParams.get('experienceId')?.trim();
  const seasonId = searchParams.get('seasonId')?.trim();

  if (!experienceId && !seasonId) {
    return NextResponse.json(
      { ok: false, error: 'Indica experienceId o seasonId.' },
      { status: 400 }
    );
  }

  const flights = await prisma.flight.findMany({
    where: experienceId ? { experienceId } : { experience: { seasonId } },
    orderBy: { startsAt: 'asc' },
    include: { experience: { select: { id: true, name: true, slug: true, seasonId: true } } }
  });

  return NextResponse.json({
    ok: true,
    flights: flights.map(flight => ({
      ...flight,
      seatsLeft: Math.max(0, flight.capacity - flight.seatsTaken)
    }))
  });
}

type GenerateInput = {
  experienceId?: unknown;
  /** 'YYYY-MM-DD' en hora local de la sede. */
  from?: unknown;
  to?: unknown;
  /** Horarios locales, p. ej. ['17:30', '19:30', '21:30']. */
  times?: unknown;
  /** Días de la semana a incluir, 0 domingo … 6 sábado. Vacío = todos. */
  weekdays?: unknown;
  capacity?: unknown;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_FLIGHTS = 500;

/**
 * POST: genera los vuelos de un rango de fechas.
 *
 * Es idempotente por diseño: el par (experiencia, instante) es único en la
 * base, así que repetir la llamada no duplica vuelos. Eso permite volver a
 * correrla para agregar un horario nuevo sin borrar nada ni tocar los vuelos
 * que ya vendieron.
 */
export async function POST(request: Request): Promise<Response> {
  const authError = checkApiKey(request);
  if (authError) {
    return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  }

  let body: GenerateInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const experienceId = typeof body.experienceId === 'string' ? body.experienceId.trim() : '';
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const times = Array.isArray(body.times) ? body.times.filter((t): t is string => typeof t === 'string') : [];

  if (!experienceId || !DATE_ONLY.test(from) || !DATE_ONLY.test(to) || times.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Faltan campos: experienceId, from, to (YYYY-MM-DD) y times (["19:30"]).' },
      { status: 400 }
    );
  }

  if (from > to) {
    return NextResponse.json({ ok: false, error: '"from" no puede ser posterior a "to".' }, { status: 400 });
  }

  const invalidTime = times.find(time => !TIME_ONLY.test(time.trim()));
  if (invalidTime) {
    return NextResponse.json({ ok: false, error: `Horario inválido: "${invalidTime}". Formato HH:mm.` }, { status: 400 });
  }

  const weekdays = Array.isArray(body.weekdays)
    ? body.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];

  const capacity = Number.isInteger(body.capacity) && (body.capacity as number) > 0 ? (body.capacity as number) : 22;

  const experience = await prisma.experience.findUnique({
    where: { id: experienceId },
    include: { season: { select: { timezone: true, name: true } } }
  });

  if (!experience) {
    return NextResponse.json({ ok: false, error: 'La experiencia no existe.' }, { status: 404 });
  }

  const timezone = experience.season.timezone;

  // Se recorre día por día en UTC a mediodía: así se evita que un cambio de
  // horario mueva el día de calendario al convertir.
  const rows: { experienceId: string; startsAt: Date; capacity: number }[] = [];
  const cursor = new Date(`${from}T12:00:00.000Z`);
  const last = new Date(`${to}T12:00:00.000Z`);

  while (cursor.getTime() <= last.getTime()) {
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(cursor);

    if (weekdays.length === 0 || weekdays.includes(zonedWeekday(cursor, timezone))) {
      for (const time of times) {
        rows.push({
          experienceId,
          startsAt: zonedTimeToUtc(`${localDate}T${time.trim()}`, timezone),
          capacity
        });
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);

    if (rows.length > MAX_FLIGHTS) {
      return NextResponse.json(
        { ok: false, error: `El rango genera más de ${MAX_FLIGHTS} vuelos. Divídelo o revisa las fechas.` },
        { status: 400 }
      );
    }
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'El rango y los días elegidos no producen ningún vuelo.' },
      { status: 400 }
    );
  }

  // skipDuplicates: los vuelos que ya existían se respetan tal cual, con sus
  // reservas y su estado. Sin esto, repetir la generación fallaría entera por
  // el índice único.
  const result = await prisma.flight.createMany({ data: rows, skipDuplicates: true });

  return NextResponse.json({
    ok: true,
    requested: rows.length,
    created: result.count,
    skipped: rows.length - result.count,
    timezone,
    season: experience.season.name
  }, { status: 201 });
}
