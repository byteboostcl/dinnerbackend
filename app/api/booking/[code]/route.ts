import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reserva por su código, para la pantalla de confirmación.
 *
 * Es pública porque el código es lo único que tiene en la mano quien acaba
 * de comprar, y tiene que poder volver a abrir su confirmación desde el
 * correo. El código es aleatorio de seis caracteres sobre un alfabeto de 31
 * (casi novecientos millones de combinaciones), así que no se adivina por
 * fuerza bruta a mano; aun así se devuelve lo mínimo y **nunca** el correo
 * ni el teléfono completos: quien ya los tiene no los necesita, y quien no,
 * no debe obtenerlos.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> }
): Promise<Response> {
  const { code } = await context.params;

  const booking = await prisma.booking.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: {
      tickets: { select: { qrToken: true } },
      flight: { include: { experience: { include: { season: true } } } }
    }
  });

  if (!booking || booking.status !== 'CONFIRMED') {
    // Mismo 404 para "no existe" y "no está confirmada": distinguirlos
    // permitiría sondear códigos.
    return NextResponse.json({ ok: false, error: 'Reserva no encontrada.' }, { status: 404 });
  }

  const season = booking.flight.experience.season;

  return NextResponse.json({
    ok: true,
    booking: {
      code: booking.code,
      status: booking.status,
      seats: booking.seats,
      amountCents: booking.amountCents,
      currency: booking.currency,
      customerName: booking.customerName,
      invoiceRequested: booking.invoiceRequested,
      preferences: booking.preferences ?? null,
      experience: booking.flight.experience.name,
      startsAt: booking.flight.startsAt,
      timezone: season.timezone,
      city: season.citySlug,
      venueName: season.venueName,
      venueAddress: season.venueAddress,
      // Un token por asiento: en puerta se valida uno por persona.
      qrTokens: booking.tickets.map(ticket => ticket.qrToken)
    }
  });
}

/**
 * PATCH — el cliente completa su experiencia después de pagar: menú,
 * alergias y si celebra algo.
 *
 * Solo se permite sobre reservas confirmadas y únicamente toca `preferences`:
 * nada de lo que se manda aquí puede cambiar el importe, los lugares ni el
 * horario.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ code: string }> }
): Promise<Response> {
  const { code } = await context.params;

  let body: { menu?: unknown; allergies?: unknown; celebration?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!booking || booking.status !== 'CONFIRMED') {
    return NextResponse.json({ ok: false, error: 'Reserva no encontrada.' }, { status: 404 });
  }

  const text = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const clean = value.trim().slice(0, max);
    return clean || null;
  };

  const preferences = {
    menu: text(body.menu, 120),
    allergies: text(body.allergies, 400),
    celebration: text(body.celebration, 200),
    updatedAt: new Date().toISOString()
  };

  await prisma.booking.update({ where: { id: booking.id }, data: { preferences } });

  return NextResponse.json({ ok: true, preferences });
}
