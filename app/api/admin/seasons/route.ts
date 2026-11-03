import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkApiKey } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Temporadas, para el panel del staff. Protegido con la misma API key que
 * /api/leads.
 *
 * Una temporada nace en borrador y solo se ve en el sitio cuando se publica
 * (PATCH status). Esto importa porque producción y staging comparten base de
 * datos: una temporada de prueba en borrador es invisible para el público.
 */

/** GET: todas las temporadas con un resumen de ocupación. */
export async function GET(request: Request): Promise<Response> {
  const authError = checkApiKey(request);
  if (authError) {
    return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  }

  const seasons = await prisma.season.findMany({
    orderBy: { startsOn: 'desc' },
    include: {
      experiences: {
        orderBy: { position: 'asc' },
        include: { _count: { select: { flights: true } } }
      }
    }
  });

  return NextResponse.json({ ok: true, seasons });
}

type ExperienceInput = {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  priceCents?: unknown;
};

type SeasonInput = {
  citySlug?: unknown;
  name?: unknown;
  venueName?: unknown;
  venueAddress?: unknown;
  timezone?: unknown;
  currency?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  experiences?: unknown;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST: crea una temporada con sus experiencias.
 *
 * Los vuelos no se crean aquí: se generan después (POST /api/admin/flights),
 * porque el calendario cambia más que la temporada y conviene poder repetir
 * esa operación sin volver a tocar precios ni nombres.
 */
export async function POST(request: Request): Promise<Response> {
  const authError = checkApiKey(request);
  if (authError) {
    return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  }

  let body: SeasonInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const citySlug = typeof body.citySlug === 'string' ? body.citySlug.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const startsOn = typeof body.startsOn === 'string' ? body.startsOn.trim() : '';
  const endsOn = typeof body.endsOn === 'string' ? body.endsOn.trim() : '';

  if (!citySlug || !name || !DATE_ONLY.test(startsOn) || !DATE_ONLY.test(endsOn)) {
    return NextResponse.json(
      { ok: false, error: 'Faltan campos: citySlug, name, startsOn y endsOn (YYYY-MM-DD).' },
      { status: 400 }
    );
  }

  if (startsOn > endsOn) {
    return NextResponse.json({ ok: false, error: 'startsOn no puede ser posterior a endsOn.' }, { status: 400 });
  }

  const timezone = typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : 'America/Hermosillo';
  // Una zona inválida rompería la generación de vuelos mucho después, con un
  // error difícil de rastrear; se valida ahora.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    return NextResponse.json({ ok: false, error: `Zona horaria desconocida: "${timezone}".` }, { status: 400 });
  }

  const rawExperiences = Array.isArray(body.experiences) ? (body.experiences as ExperienceInput[]) : [];
  if (rawExperiences.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'La temporada necesita al menos una experiencia (lo que se vende y a qué precio).' },
      { status: 400 }
    );
  }

  const experiences = [];
  for (const [index, raw] of rawExperiences.entries()) {
    const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
    const expName = typeof raw.name === 'string' ? raw.name.trim() : '';
    const priceCents = typeof raw.priceCents === 'number' ? raw.priceCents : NaN;

    if (!slug || !expName || !Number.isInteger(priceCents) || priceCents <= 0) {
      return NextResponse.json(
        { ok: false, error: `Experiencia ${index + 1}: hacen falta slug, name y priceCents (entero en centavos).` },
        { status: 400 }
      );
    }

    experiences.push({
      slug,
      name: expName,
      description: typeof raw.description === 'string' ? raw.description.trim() : null,
      priceCents,
      position: index
    });
  }

  const season = await prisma.season.create({
    data: {
      citySlug,
      name,
      venueName: typeof body.venueName === 'string' ? body.venueName.trim() : null,
      venueAddress: typeof body.venueAddress === 'string' ? body.venueAddress.trim() : null,
      timezone,
      currency: typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim() : 'MXN',
      startsOn: new Date(`${startsOn}T00:00:00.000Z`),
      endsOn: new Date(`${endsOn}T00:00:00.000Z`),
      experiences: { create: experiences }
    },
    include: { experiences: true }
  });

  return NextResponse.json({ ok: true, season }, { status: 201 });
}
