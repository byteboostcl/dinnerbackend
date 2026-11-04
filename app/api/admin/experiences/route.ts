import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateInput = {
  seasonId?: unknown;
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  priceCents?: unknown;
};

/** Minúsculas, sin acentos y con guiones: el slug viaja a GA4 como item_id. */
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** POST /api/admin/experiences: agrega una experiencia a una temporada existente. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  let body: CreateInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const seasonId = typeof body.seasonId === 'string' ? body.seasonId : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const priceCents = typeof body.priceCents === 'number' ? body.priceCents : NaN;

  if (!seasonId) {
    return NextResponse.json({ ok: false, error: 'Falta seasonId.' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ ok: false, error: 'El nombre no puede estar vacío.' }, { status: 400 });
  }
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    return NextResponse.json(
      { ok: false, error: 'priceCents debe ser un entero mayor que cero (centavos).' },
      { status: 400 }
    );
  }

  const rawSlug = typeof body.slug === 'string' && body.slug.trim() ? body.slug : name;
  const slug = slugify(rawSlug);
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'No se pudo generar un slug válido con ese nombre.' }, { status: 400 });
  }

  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { id: true } });
  if (!season) {
    return NextResponse.json({ ok: false, error: 'La temporada no existe.' }, { status: 404 });
  }

  const existing = await prisma.experience.findUnique({
    where: { seasonId_slug: { seasonId, slug } },
    select: { id: true }
  });
  if (existing) {
    return NextResponse.json(
      { ok: false, error: `Ya existe una experiencia con el identificador "${slug}" en esta temporada. Usa otro nombre.` },
      { status: 409 }
    );
  }

  // Se coloca al final para no reordenar las que ya se muestran en el sitio.
  const last = await prisma.experience.aggregate({ where: { seasonId }, _max: { position: true } });

  const experience = await prisma.experience.create({
    data: {
      seasonId,
      slug,
      name,
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
      priceCents,
      position: (last._max.position ?? -1) + 1
    }
  });

  return NextResponse.json({ ok: true, experience }, { status: 201 });
}
