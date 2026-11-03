import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/promos/:id — activar, desactivar o ajustar vigencia.
 *
 * No hay DELETE: borrar un código dejaría reservas apuntando a nada. Se
 * desactiva, y el historial de lo que se descontó sigue en pie.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const promo = await prisma.promoCode.findUnique({ where: { id } });
  if (!promo) {
    return NextResponse.json({ ok: false, error: 'Ese código no existe.' }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body['active'] === 'boolean') {
    data['active'] = body['active'];
  }
  if (body['validUntil'] !== undefined) {
    const d = typeof body['validUntil'] === 'string' ? new Date(body['validUntil']) : null;
    data['validUntil'] = d && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (body['maxRedemptions'] !== undefined) {
    data['maxRedemptions'] = Number.isInteger(body['maxRedemptions']) ? body['maxRedemptions'] : null;
  }
  if (typeof body['description'] === 'string') {
    data['description'] = body['description'].trim() || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: 'No hay nada que cambiar.' }, { status: 400 });
  }

  const actualizado = await prisma.promoCode.update({ where: { id }, data });
  const usos = await prisma.booking.count({ where: { promoCodeId: id, status: 'CONFIRMED' } });

  return NextResponse.json({ ok: true, promo: actualizado, confirmedBookings: usos });
}
