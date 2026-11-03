import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyPromo } from '@/lib/promo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/booking/promo — comprueba un código y devuelve el total con el
 * descuento ya calculado, para mostrarlo antes de pagar.
 *
 * Consultar NO consume el canje: eso pasa al confirmar el pago. Si gastara
 * un uso aquí, probar un código agotaría una promoción limitada sin que
 * nadie comprara.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { code?: unknown; flightId?: unknown; seats?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const flightId = typeof body.flightId === 'string' ? body.flightId : '';
  const seats = Number(body.seats);

  if (!code || !flightId || !Number.isInteger(seats) || seats < 1) {
    return NextResponse.json(
      { ok: false, error: 'Faltan datos: código, horario y número de lugares.' },
      { status: 400 }
    );
  }

  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    include: { experience: true }
  });

  if (!flight) {
    return NextResponse.json({ ok: false, error: 'Ese horario no existe.' }, { status: 404 });
  }

  const resultado = await applyPromo(code, {
    seats,
    unitPriceCents: flight.experience.priceCents,
    seasonId: flight.experience.seasonId,
    experienceId: flight.experienceId
  });

  if (!resultado.ok) {
    // 200 con ok:false: el código inválido es una respuesta normal de la
    // pantalla de compra, no un fallo de la petición.
    return NextResponse.json({ ok: false, error: resultado.message, reason: resultado.reason });
  }

  return NextResponse.json({ ok: true, promo: resultado });
}
