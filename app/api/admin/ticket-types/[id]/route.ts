import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/ticket-types/:id — precio, nombre, límites o retirarlo.
 *
 * No se permite borrar: un tipo de ticket puede estar en reservas vendidas.
 * Se desactiva con `active: false`, y deja de ofrecerse sin romper el
 * historial.
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

  const existente = await prisma.ticketType.findUnique({ where: { id } });
  if (!existente) {
    return NextResponse.json({ ok: false, error: 'Ese boleto no existe.' }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (typeof body['name'] === 'string' && body['name'].trim()) {
    data['name'] = body['name'].trim();
  }
  if (body['note'] !== undefined) {
    data['note'] = typeof body['note'] === 'string' && body['note'].trim() ? body['note'].trim() : null;
  }
  if (body['priceCents'] !== undefined) {
    const priceCents = Number(body['priceCents']);
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      return NextResponse.json({ ok: false, error: 'El precio debe ser un entero en centavos.' }, { status: 400 });
    }
    data['priceCents'] = priceCents;
  }
  if (body['maxPerBooking'] !== undefined) {
    data['maxPerBooking'] = Number.isInteger(body['maxPerBooking']) ? body['maxPerBooking'] : null;
  }
  if (typeof body['active'] === 'boolean') {
    data['active'] = body['active'];
  }
  if (Number.isInteger(body['position'])) {
    data['position'] = body['position'];
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: 'No hay nada que cambiar.' }, { status: 400 });
  }

  const ticketType = await prisma.ticketType.update({ where: { id }, data });

  // Cambiar el precio no toca lo ya vendido: cada línea de reserva guarda el
  // precio con el que se compró.
  const vendidos = await prisma.bookingItem.count({
    where: { ticketTypeId: id, booking: { status: 'CONFIRMED' } }
  });

  return NextResponse.json({
    ok: true,
    ticketType,
    soldCount: vendidos,
    note: vendidos > 0 ? 'Las reservas ya pagadas conservan el precio con el que se compraron.' : null
  });
}
