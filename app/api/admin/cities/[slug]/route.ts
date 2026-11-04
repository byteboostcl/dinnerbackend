import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * PATCH — editar una sede.
 *
 * Se puede cambiar el nombre, la zona, el orden, la nota y desactivarla. NO se
 * puede cambiar el slug: es la llave que une esta ciudad con su página del
 * sitio y con todas sus temporadas; renombrarlo dejaría las reservas vendidas
 * apuntando a una ciudad que ya no existe.
 *
 * Tampoco se puede cambiar `siteStatus`. Que una ciudad salga en el sitio
 * depende de que alguien construya su página en el Angular, no de marcar una
 * casilla aquí. Ese cambio lo hace quien despliega, con scripts/city-live.mjs.
 *
 * No hay DELETE: una ciudad con temporadas vendidas tiene que seguir
 * existiendo para poder explicar esas reservas. Para retirarla se desactiva.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { slug } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const city = await prisma.city.findUnique({ where: { slug } });
  if (!city) {
    return NextResponse.json({ ok: false, error: 'Esa ciudad no existe.' }, { status: 404 });
  }

  const data: {
    name?: string;
    timezone?: string;
    position?: number;
    active?: boolean;
    notes?: string | null;
  } = {};

  if (typeof body['name'] === 'string') {
    const name = body['name'].trim();
    if (!name) {
      return NextResponse.json({ ok: false, error: 'El nombre no puede quedar vacío.' }, { status: 400 });
    }
    data.name = name;
  }

  if (typeof body['timezone'] === 'string') {
    const timezone = body['timezone'].trim();
    try {
      new Intl.DateTimeFormat('es-MX', { timeZone: timezone });
    } catch {
      return NextResponse.json(
        { ok: false, error: `"${timezone}" no es una zona horaria válida.` },
        { status: 400 }
      );
    }
    data.timezone = timezone;
  }

  if (typeof body['position'] === 'number' && Number.isInteger(body['position'])) {
    data.position = body['position'];
  }

  if (typeof body['notes'] === 'string') {
    data.notes = body['notes'].trim() || null;
  }

  let aviso: string | undefined;

  if (typeof body['active'] === 'boolean') {
    data.active = body['active'];

    if (!body['active']) {
      // Desactivar una ciudad no cierra sus temporadas ni cancela nada: solo
      // la saca de las listas al crear. Decirlo evita que alguien crea que
      // con esto dejó de vender.
      const vivas = await prisma.season.count({
        where: { citySlug: slug, status: 'PUBLISHED' }
      });
      if (vivas > 0) {
        aviso = `${vivas} temporada(s) de esta ciudad siguen publicadas y vendiendo. Ciérralas desde Temporadas si eso no es lo que quieres.`;
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: 'No mandaste nada que cambiar.' }, { status: 400 });
  }

  const actualizada = await prisma.city.update({ where: { slug }, data });
  return NextResponse.json({ ok: true, city: actualizada, warning: aviso });
}
