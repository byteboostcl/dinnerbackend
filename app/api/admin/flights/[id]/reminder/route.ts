import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';
import { buscarPlantilla, sendBookingReminder } from '@/lib/mailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un vuelo tiene como máximo una mesa de reservas y se envía en serie con
// pausa: con el tope por defecto de la plataforma el lote podría cortarse a
// la mitad, dejando a medio grupo sin aviso y sin saber a quién.
export const maxDuration = 60;

const KIND = 'booking_reminder';

/**
 * Pausa entre correos. Resend limita la tasa de peticiones por segundo; en
 * serie y con este margen un lote no la roza. No se usa una librería de
 * colas porque el lote cabe de sobra en una sola petición.
 */
const PAUSA_MS = 600;

/** Vuelos con un lote en curso en este proceso, para frenar el doble clic. */
const enCurso = new Set<string>();

type Contexto = { params: Promise<{ id: string }> };

const pausa = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Carga el vuelo con sus reservas confirmadas y separa a quién ya se le
 * mandó. Es la misma lógica para el conteo (GET) y el envío (POST): que
 * ambos vean lo mismo evita que el botón prometa un número y mande otro.
 */
async function cargarLote(flightId: string) {
  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    include: { experience: { include: { season: true } } }
  });
  if (!flight) return null;

  const bookings = await prisma.booking.findMany({
    where: { flightId, status: 'CONFIRMED' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true, customerEmail: true }
  });

  // Solo cuenta lo que el proveedor aceptó: un intento fallido o una omisión
  // por falta de clave no es un recordatorio entregado y debe poder
  // reintentarse.
  const previos = await prisma.emailLog.findMany({
    where: { kind: KIND, ok: true, bookingId: { in: bookings.map(b => b.id) } },
    select: { bookingId: true }
  });
  const yaEnviados = new Set(previos.map(p => p.bookingId));

  return { flight, bookings, yaEnviados };
}

/**
 * GET /api/admin/flights/:id/reminder — cuántos recibirían el recordatorio,
 * sin enviar nada. Es lo que el equipo mira antes de apretar el botón.
 */
export async function GET(request: Request, context: Contexto): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id } = await context.params;
  const lote = await cargarLote(id);
  if (!lote) {
    return NextResponse.json({ ok: false, error: 'El vuelo no existe.' }, { status: 404 });
  }

  const plantilla = await buscarPlantilla(KIND, lote.flight.experience.season.id);
  const alreadySent = lote.bookings.filter(b => lote.yaEnviados.has(b.id)).length;

  return NextResponse.json({
    ok: true,
    flightId: lote.flight.id,
    confirmed: lote.bookings.length,
    alreadySent,
    pending: lote.bookings.length - alreadySent,
    // El equipo debe enterarse aquí, no después de apretar el botón, de que
    // no hay nada que enviar por falta de plantilla o de clave.
    templateConfigured: plantilla !== null,
    mailConfigured: Boolean(process.env['RESEND_API_KEY'])
  });
}

/**
 * POST /api/admin/flights/:id/reminder — manda el recordatorio a las reservas
 * CONFIRMED del vuelo.
 *
 * Cuerpo opcional: { force: true } reenvía también a quien ya lo recibió. Solo
 * el booleano `true` lo activa; cualquier otro valor se trata como false, para
 * que un campo mal formado nunca duplique correos por accidente.
 *
 * `sentBy` sale de la sesión, jamás del cuerpo.
 */
export async function POST(request: Request, context: Contexto): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id } = await context.params;

  let force = false;
  const texto = await request.text();
  if (texto.trim()) {
    try {
      const body: unknown = JSON.parse(texto);
      force = typeof body === 'object' && body !== null && (body as Record<string, unknown>)['force'] === true;
    } catch {
      return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
    }
  }

  const lote = await cargarLote(id);
  if (!lote) {
    return NextResponse.json({ ok: false, error: 'El vuelo no existe.' }, { status: 404 });
  }

  if (lote.flight.status === 'CANCELLED') {
    return NextResponse.json(
      { ok: false, error: 'El vuelo está cancelado: un recordatorio contradiría el aviso de cancelación.' },
      { status: 409 }
    );
  }
  if (lote.flight.startsAt.getTime() <= Date.now()) {
    return NextResponse.json({ ok: false, error: 'El vuelo ya despegó; no tiene sentido recordarlo.' }, { status: 409 });
  }

  // Se comprueba antes del ciclo: sin clave o sin plantilla cada reserva
  // fallaría igual y la bitácora se llenaría de filas idénticas.
  if (!process.env['RESEND_API_KEY']) {
    return NextResponse.json({ ok: false, error: 'RESEND_API_KEY no está configurada en el servidor.' }, { status: 503 });
  }
  const plantilla = await buscarPlantilla(KIND, lote.flight.experience.season.id);
  if (!plantilla) {
    return NextResponse.json(
      { ok: false, error: 'No hay plantilla "booking_reminder" activa para esta temporada ni general.' },
      { status: 422 }
    );
  }

  if (enCurso.has(id)) {
    return NextResponse.json({ ok: false, error: 'Ya hay un envío de recordatorios en curso para este vuelo.' }, { status: 409 });
  }
  enCurso.add(id);

  try {
    let sent = 0;
    let skippedAlreadySent = 0;
    const failures: { code: string; email: string; error: string }[] = [];
    let huboEnvio = false;

    for (const booking of lote.bookings) {
      if (!force && lote.yaEnviados.has(booking.id)) {
        skippedAlreadySent += 1;
        continue;
      }

      if (!force) {
        // Segunda comprobación justo antes de enviar: si otra petición (otra
        // pestaña, otra instancia) ya lo mandó mientras este lote corría,
        // se evita el duplicado. No cierra la ventana del todo, solo la
        // reduce a lo que dura un envío.
        const reciente = await prisma.emailLog.findFirst({
          where: { kind: KIND, ok: true, bookingId: booking.id },
          select: { id: true }
        });
        if (reciente) {
          skippedAlreadySent += 1;
          continue;
        }
      }

      if (huboEnvio) await pausa(PAUSA_MS);
      huboEnvio = true;

      // Un fallo individual se anota y el lote continúa.
      const envio = await sendBookingReminder(booking.id, auth.actor);
      if (envio.ok) {
        sent += 1;
      } else {
        failures.push({
          code: booking.code,
          email: booking.customerEmail,
          error: envio.error ?? envio.skipped ?? 'Error desconocido.'
        });
      }
    }

    return NextResponse.json({
      ok: true,
      flightId: lote.flight.id,
      forced: force,
      confirmed: lote.bookings.length,
      sent,
      skippedAlreadySent,
      failed: failures.length,
      failures
    });
  } finally {
    enCurso.delete(id);
  }
}
