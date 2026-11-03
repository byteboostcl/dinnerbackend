import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Disponibilidad pública de una temporada: qué se vende, en qué vuelos y
 * cuántos lugares quedan. Es lo que el sitio consulta para pintar el
 * calendario; no requiere API key porque es información de venta.
 *
 * GET /api/booking/availability?city=hermosillo
 *
 * Qué NO devuelve, a propósito:
 * - Vuelos ya pasados ni temporadas en borrador o cerradas.
 * - El contador interno de lugares comprometidos. Hacia afuera solo se
 *   expone `seatsLeft`, para no publicar cuántas reservas lleva la empresa.
 * - Dato alguno de clientes.
 *
 * Los lugares que informa son una foto del momento: entre esta consulta y el
 * pago alguien más puede comprar. Quien decide de verdad es el apartado, que
 * se hace con un UPDATE condicional al crear la reserva.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get('city')?.trim();

  if (!city) {
    return NextResponse.json(
      { ok: false, error: 'Falta el parámetro city.' },
      { status: 400 }
    );
  }

  const season = await prisma.season.findFirst({
    where: { citySlug: city, status: 'PUBLISHED' },
    orderBy: { startsOn: 'asc' },
    include: {
      experiences: {
        orderBy: { position: 'asc' },
        include: {
          flights: {
            // Un vuelo que ya despegó no se vende, y uno cerrado a mano
            // tampoco debe aparecer con lugares disponibles.
            where: { startsAt: { gte: new Date() }, status: 'SCHEDULED' },
            orderBy: { startsAt: 'asc' }
          }
        }
      }
    }
  });

  if (!season) {
    // No es un error: simplemente esa ciudad no tiene temporada en venta.
    return NextResponse.json({ ok: true, season: null });
  }

  return NextResponse.json({
    ok: true,
    season: {
      id: season.id,
      citySlug: season.citySlug,
      name: season.name,
      venueName: season.venueName,
      venueAddress: season.venueAddress,
      timezone: season.timezone,
      currency: season.currency,
      startsOn: season.startsOn,
      endsOn: season.endsOn,
      experiences: season.experiences.map(experience => ({
        id: experience.id,
        slug: experience.slug,
        name: experience.name,
        description: experience.description,
        priceCents: experience.priceCents,
        flights: experience.flights.map(flight => {
          const seatsLeft = Math.max(0, flight.capacity - flight.seatsTaken);
          return {
            id: flight.id,
            startsAt: flight.startsAt,
            seatsLeft,
            soldOut: seatsLeft === 0
          };
        })
      }))
    }
  });
}
