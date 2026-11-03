import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/ticket-types?experienceId=… */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const experienceId = new URL(request.url).searchParams.get('experienceId')?.trim();
  if (!experienceId) {
    return NextResponse.json({ ok: false, error: 'Falta experienceId.' }, { status: 400 });
  }

  const ticketTypes = await prisma.ticketType.findMany({
    where: { experienceId },
    orderBy: [{ occupiesSeat: 'desc' }, { position: 'asc' }]
  });

  return NextResponse.json({ ok: true, ticketTypes });
}

/**
 * POST — crea un tipo de ticket o un extra.
 *
 * `occupiesSeat` en false lo convierte en extra: se cobra pero no consume
 * plaza de la mesa. Es como se modelan el paquete de anillo, la botella o
 * el pastelito.
 */
export async function POST(request: Request): Promise<Response> {
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

  const experienceId = typeof body['experienceId'] === 'string' ? body['experienceId'].trim() : '';
  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  const priceCents = Number(body['priceCents']);

  if (!experienceId || !name || !Number.isInteger(priceCents) || priceCents < 0) {
    return NextResponse.json(
      { ok: false, error: 'Faltan datos: experiencia, nombre y precio en centavos.' },
      { status: 400 }
    );
  }

  const experiencia = await prisma.experience.findUnique({ where: { id: experienceId } });
  if (!experiencia) {
    return NextResponse.json({ ok: false, error: 'La experiencia no existe.' }, { status: 404 });
  }

  // Slug a partir del nombre si no lo mandan: es lo que viaja a GA4, así que
  // conviene que sea legible y estable.
  const slug = (typeof body['slug'] === 'string' && body['slug'].trim() ? body['slug'] : name)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const maxPerBooking = Number.isInteger(body['maxPerBooking']) ? (body['maxPerBooking'] as number) : null;

  try {
    const ticketType = await prisma.ticketType.create({
      data: {
        experienceId,
        slug,
        name,
        note: typeof body['note'] === 'string' && body['note'].trim() ? body['note'].trim() : null,
        priceCents,
        occupiesSeat: body['occupiesSeat'] !== false,
        minPerBooking: Number.isInteger(body['minPerBooking']) ? (body['minPerBooking'] as number) : 0,
        maxPerBooking,
        position: Number.isInteger(body['position']) ? (body['position'] as number) : 0
      }
    });
    return NextResponse.json({ ok: true, ticketType }, { status: 201 });
  } catch (error) {
    if (String(error).includes('ticket_types_experienceId_slug_key')) {
      return NextResponse.json(
        { ok: false, error: `Ya existe un boleto con el identificador "${slug}" en esta experiencia.` },
        { status: 409 }
      );
    }
    throw error;
  }
}
