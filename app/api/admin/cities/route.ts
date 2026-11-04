import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sedes.
 *
 * El equipo da de alta una ciudad y ya puede crearle temporadas, vuelos y
 * precios. Lo que NO puede hacer desde aquí es ponerla en el sitio: para eso
 * hay que construir su página en el repositorio Angular. Por eso `siteStatus`
 * no se acepta en ningún body de estos endpoints, ni al crear ni al editar.
 *
 * Decirlo en voz alta importa: si el panel dejara marcar "LIVE" sin que la
 * página exista, Joan publicaría una temporada, no la vería en el sitio y no
 * tendría forma de saber por qué.
 */

/** Slug de ruta: minúsculas, números y guiones. Es lo que va en la URL. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const cities = await prisma.city.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] });

  // Cuántas temporadas tiene cada una: sin esto no hay forma de saber desde
  // el panel si una ciudad está realmente en uso o solo dada de alta.
  const porCiudad = await prisma.season.groupBy({
    by: ['citySlug'],
    _count: { _all: true }
  });
  const conteo = new Map(porCiudad.map(s => [s.citySlug, s._count._all]));

  return NextResponse.json({
    ok: true,
    cities: cities.map(c => ({ ...c, seasons: conteo.get(c.slug) ?? 0 }))
  });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  const timezone = typeof body['timezone'] === 'string' ? body['timezone'].trim() : '';
  // El slug se puede dictar, pero si no viene se deriva del nombre: es lo que
  // menos errores produce, porque nadie tiene que acordarse de las reglas.
  const slug = typeof body['slug'] === 'string' && body['slug'].trim() ? slugify(body['slug']) : slugify(name);

  if (!name) {
    return NextResponse.json({ ok: false, error: 'Falta el nombre de la ciudad.' }, { status: 400 });
  }
  if (!SLUG.test(slug)) {
    return NextResponse.json(
      { ok: false, error: 'El slug solo admite minúsculas, números y guiones.' },
      { status: 400 }
    );
  }
  if (!timezone) {
    return NextResponse.json({ ok: false, error: 'Falta la zona horaria.' }, { status: 400 });
  }
  // Una zona inventada corre todos los vuelos de la ciudad. Se comprueba
  // contra el propio Intl en vez de contra una lista nuestra, que envejecería.
  try {
    new Intl.DateTimeFormat('es-MX', { timeZone: timezone });
  } catch {
    return NextResponse.json(
      { ok: false, error: `"${timezone}" no es una zona horaria válida (ejemplo: America/Hermosillo).` },
      { status: 400 }
    );
  }

  const existente = await prisma.city.findUnique({ where: { slug } });
  if (existente) {
    return NextResponse.json(
      { ok: false, error: `Ya existe una ciudad con el slug "${slug}" (${existente.name}).` },
      { status: 409 }
    );
  }

  const ultima = await prisma.city.findFirst({ orderBy: { position: 'desc' } });

  const city = await prisma.city.create({
    data: {
      slug,
      name,
      timezone,
      position: (ultima?.position ?? 0) + 1,
      notes: typeof body['notes'] === 'string' ? body['notes'].trim() || null : null
    }
  });

  return NextResponse.json(
    {
      ok: true,
      city,
      aviso:
        'La ciudad ya admite temporadas y vuelos, pero todavía no tiene página en el sitio: ' +
        'hasta que se construya, lo que se publique aquí no se ve en dinnerinthesky.com.mx.'
    },
    { status: 201 }
  );
}
