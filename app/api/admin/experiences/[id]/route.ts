import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PatchInput = {
  name?: unknown;
  description?: unknown;
  priceCents?: unknown;
  position?: unknown;
};

/**
 * PATCH /api/admin/experiences/:id: corrige nombre, descripción, precio y orden.
 *
 * No hay DELETE a propósito: una experiencia puede colgar de reservas ya
 * vendidas. El slug tampoco se edita, porque es el item_id de GA4.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const { id } = await context.params;

  let body: PatchInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const current = await prisma.experience.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ ok: false, error: 'La experiencia no existe.' }, { status: 404 });
  }

  const data: { name?: string; description?: string | null; priceCents?: number; position?: number } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ ok: false, error: 'El nombre no puede estar vacío.' }, { status: 400 });
    }
    data.name = body.name.trim();
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
  }
  if (body.priceCents !== undefined) {
    if (typeof body.priceCents !== 'number' || !Number.isInteger(body.priceCents) || body.priceCents <= 0) {
      return NextResponse.json(
        { ok: false, error: 'priceCents debe ser un entero mayor que cero (centavos).' },
        { status: 400 }
      );
    }
    data.priceCents = body.priceCents;
  }
  if (body.position !== undefined) {
    if (typeof body.position !== 'number' || !Number.isInteger(body.position) || body.position < 0) {
      return NextResponse.json({ ok: false, error: 'position debe ser un entero mayor o igual a cero.' }, { status: 400 });
    }
    data.position = body.position;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: 'No hay nada que cambiar.' }, { status: 400 });
  }

  const experience = await prisma.experience.update({ where: { id }, data });

  let confirmedBookings: number | undefined;
  let warning: string | null = null;
  if (data.priceCents !== undefined && data.priceCents !== current.priceCents) {
    confirmedBookings = await prisma.booking.count({
      where: { status: 'CONFIRMED', flight: { experienceId: id } }
    });
    warning =
      confirmedBookings > 0
        ? `Hay ${confirmedBookings} reserva(s) confirmada(s) en esta experiencia. Conservan el precio con el que se compraron; el nuevo precio solo aplica a compras futuras.`
        : 'Todavía no hay reservas confirmadas en esta experiencia; el nuevo precio aplica a todas las compras futuras.';
  }

  return NextResponse.json({ ok: true, experience, confirmedBookings: confirmedBookings ?? null, warning });
}
