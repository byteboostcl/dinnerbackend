import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';
import { MARCADORES } from '@/lib/email-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLAVES = ['booking_confirmation'] as const;

/** GET — plantillas guardadas y la lista de marcadores disponibles. */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const templates = await prisma.emailTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
  return NextResponse.json({ ok: true, templates, placeholders: MARCADORES });
}

/**
 * PUT — guarda la plantilla (crea o reemplaza la de esa clave y temporada).
 *
 * El cuerpo se guarda tal cual, con su HTML: el correo es HTML y limpiarlo
 * aquí rompería maquetaciones que el equipo arma a mano. A cambio, solo
 * llega desde el panel, que exige sesión.
 */
export async function PUT(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const key = typeof body['key'] === 'string' ? body['key'] : 'booking_confirmation';
  const subject = typeof body['subject'] === 'string' ? body['subject'].trim() : '';
  const bodyHtml = typeof body['bodyHtml'] === 'string' ? body['bodyHtml'] : '';
  const seasonId = typeof body['seasonId'] === 'string' && body['seasonId'] ? body['seasonId'] : null;

  if (!CLAVES.includes(key as (typeof CLAVES)[number])) {
    return NextResponse.json({ ok: false, error: 'Plantilla desconocida.' }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json(
      { ok: false, error: 'El asunto no puede ir vacío: en TuriTop varias plantillas lo tenían y nadie sabe qué llegaba.' },
      { status: 400 }
    );
  }
  if (!bodyHtml.trim()) {
    return NextResponse.json({ ok: false, error: 'El cuerpo no puede ir vacío.' }, { status: 400 });
  }

  // El índice único admite seasonId nulo (la plantilla general), pero el
  // tipo de `upsert` en Prisma no acepta null en la clave compuesta. Se
  // resuelve buscando primero.
  const existente = await prisma.emailTemplate.findFirst({ where: { key, seasonId } });

  const template = existente
    ? await prisma.emailTemplate.update({
        where: { id: existente.id },
        data: { subject, bodyHtml, updatedBy: auth.actor }
      })
    : await prisma.emailTemplate.create({
        data: { key, seasonId, subject, bodyHtml, updatedBy: auth.actor }
      });

  return NextResponse.json({ ok: true, template });
}
