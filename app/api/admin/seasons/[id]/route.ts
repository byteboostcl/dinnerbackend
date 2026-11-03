import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkApiKey } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUS = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;
type SeasonStatusValue = (typeof VALID_STATUS)[number];

type PatchInput = {
  status?: unknown;
  name?: unknown;
  venueName?: unknown;
  venueAddress?: unknown;
};

/**
 * PATCH /api/admin/seasons/:id — publicar, cerrar o corregir una temporada.
 *
 * Publicar es la acción con consecuencias: en ese momento la temporada
 * aparece en el sitio y se puede comprar. Por eso antes de publicar se
 * comprueba que haya vuelos abiertos; una temporada publicada sin vuelos es
 * una página que invita a reservar y no deja hacerlo.
 *
 * Cerrar no cancela nada: deja de venderse, pero las reservas confirmadas
 * siguen válidas y la gente tiene que poder volar.
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

  const season = await prisma.season.findUnique({ where: { id } });
  if (!season) {
    return NextResponse.json({ ok: false, error: 'La temporada no existe.' }, { status: 404 });
  }

  const data: { status?: SeasonStatusValue; name?: string; venueName?: string | null; venueAddress?: string | null } = {};

  if (body.status !== undefined) {
    const status = String(body.status).toUpperCase();
    if (!VALID_STATUS.includes(status as SeasonStatusValue)) {
      return NextResponse.json(
        { ok: false, error: `status debe ser uno de: ${VALID_STATUS.join(', ')}.` },
        { status: 400 }
      );
    }

    if (status === 'PUBLISHED') {
      const openFlights = await prisma.flight.count({
        where: { experience: { seasonId: id }, status: 'SCHEDULED', startsAt: { gte: new Date() } }
      });

      if (openFlights === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: 'No se puede publicar: la temporada no tiene vuelos abiertos a futuro. Genera los vuelos primero.'
          },
          { status: 409 }
        );
      }
    }

    data.status = status as SeasonStatusValue;
  }

  if (typeof body.name === 'string' && body.name.trim()) {
    data.name = body.name.trim();
  }
  if (body.venueName !== undefined) {
    data.venueName = typeof body.venueName === 'string' && body.venueName.trim() ? body.venueName.trim() : null;
  }
  if (body.venueAddress !== undefined) {
    data.venueAddress = typeof body.venueAddress === 'string' && body.venueAddress.trim() ? body.venueAddress.trim() : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: 'No hay nada que cambiar.' }, { status: 400 });
  }

  const updated = await prisma.season.update({ where: { id }, data });

  // Al publicar se avisa de otra temporada ya publicada en la misma ciudad:
  // el endpoint público toma la primera por fecha, así que dos a la vez
  // significa que una de ellas no se va a ver y nadie sabría por qué.
  let warning: string | null = null;
  if (data.status === 'PUBLISHED') {
    const otras = await prisma.season.count({
      where: { citySlug: updated.citySlug, status: 'PUBLISHED', id: { not: id } }
    });
    if (otras > 0) {
      warning = `Hay ${otras} temporada(s) más publicada(s) en ${updated.citySlug}. El sitio muestra solo la de fecha de inicio más próxima.`;
    }
  }

  return NextResponse.json({ ok: true, season: updated, warning });
}
