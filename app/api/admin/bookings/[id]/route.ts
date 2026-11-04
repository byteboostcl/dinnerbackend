import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';
import { cancelBooking } from '@/lib/cancel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/admin/bookings/:id — detalle y correcciones de una reserva.
 *
 * No hay DELETE a propósito: una reserva vendida tiene que seguir existiendo
 * para poder explicar un cobro, un reembolso o un lugar ocupado. Lo que se
 * hace es cancelarla (PATCH action 'cancel'), y eso deja el rastro.
 */

type RouteContext = { params: Promise<{ id: string }> };

const NAME_MAX = 120;
const PHONE_MAX = 40;
const NOTES_MAX = 5000;
const REASON_MAX = 500;

// Validación de forma, no de entregabilidad: basta para cazar el error de
// captura típico (falta la @, espacios, sin dominio). Un correo inexistente
// solo se descubre al enviar.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(error: string, status = 400): Response {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return fail(auth.error, 401);
  }

  const { id } = await context.params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      flight: { include: { experience: { include: { season: true } } } },
      items: true,
      tickets: { orderBy: { createdAt: 'asc' } },
      promoCode: { select: { id: true, code: true, kind: true, description: true } }
    }
  });

  if (!booking) {
    return fail('Esa reserva no existe.', 404);
  }

  return NextResponse.json({ ok: true, booking });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return fail(auth.error, 401);
  }

  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail('El cuerpo de la petición no es válido.');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return fail('El cuerpo de la petición no es válido.');
  }

  const contactKeys = ['customerName', 'customerEmail', 'customerPhone'] as const;
  const hasContact = contactKeys.some(key => body[key] !== undefined);
  const hasNotes = body['internalNotes'] !== undefined;

  if (body['action'] !== undefined) {
    if (body['action'] !== 'cancel') {
      return fail('Esa acción no existe. La única disponible es "cancel".');
    }
    // Cancelar y editar en la misma petición dejaría a medias una de las dos
    // si la otra falla. Cada operación va sola.
    if (hasContact || hasNotes) {
      return fail('Cancelar la reserva y editar sus datos son operaciones separadas. Envíalas por separado.');
    }
    return cancel(id, body, auth.actor);
  }

  if (!hasContact && !hasNotes) {
    return fail('No hay nada que cambiar.');
  }

  const data: Prisma.BookingUpdateInput = {};

  if (body['customerName'] !== undefined) {
    const name = typeof body['customerName'] === 'string' ? body['customerName'].trim() : '';
    if (!name) {
      return fail('El nombre del cliente no puede quedar vacío.');
    }
    if (name.length > NAME_MAX) {
      return fail(`El nombre es demasiado largo (máximo ${NAME_MAX} caracteres).`);
    }
    data.customerName = name;
  }

  if (body['customerEmail'] !== undefined) {
    // Minúsculas y sin espacios, igual que al crear la reserva en /booking/hold,
    // para que la búsqueda por correo encuentre las dos versiones.
    const email = typeof body['customerEmail'] === 'string' ? body['customerEmail'].trim().toLowerCase() : '';
    if (!EMAIL_FORMAT.test(email)) {
      return fail('El correo no tiene un formato válido. Revisa que lleve @ y un dominio, por ejemplo nombre@correo.com.');
    }
    data.customerEmail = email;
  }

  if (body['customerPhone'] !== undefined) {
    const raw = body['customerPhone'];
    if (raw !== null && typeof raw !== 'string') {
      return fail('El teléfono no es válido.');
    }
    const phone = raw === null ? '' : raw.trim();
    if (phone.length > PHONE_MAX) {
      return fail(`El teléfono es demasiado largo (máximo ${PHONE_MAX} caracteres).`);
    }
    // El teléfono es opcional en la reserva: vaciarlo es una corrección válida.
    data.customerPhone = phone || null;
  }

  if (hasNotes) {
    const raw = body['internalNotes'];
    if (raw !== null && typeof raw !== 'string') {
      return fail('Las notas internas no son válidas.');
    }
    const notes = raw === null ? '' : raw.trim();
    if (notes.length > NOTES_MAX) {
      return fail(`Las notas son demasiado largas (máximo ${NOTES_MAX} caracteres).`);
    }
    data.internalNotes = notes || null;
  }

  const existe = await prisma.booking.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    return fail('Esa reserva no existe.', 404);
  }

  const booking = await prisma.booking.update({ where: { id }, data });
  return NextResponse.json({ ok: true, booking });
}

async function cancel(id: string, body: Record<string, unknown>, actor: string): Promise<Response> {
  const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
  if (!reason) {
    return fail('Escribe el motivo de la cancelación.');
  }
  if (reason.length > REASON_MAX) {
    return fail(`El motivo es demasiado largo (máximo ${REASON_MAX} caracteres).`);
  }

  let refundCents: number | undefined;
  if (body['refundCents'] !== undefined && body['refundCents'] !== null) {
    const raw = body['refundCents'];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      return fail('El reembolso debe ser un importe en centavos, entero y no negativo.');
    }
    refundCents = raw;
  }

  // El actor viene de la sesión, no del body: si lo aceptáramos de ahí,
  // cualquiera podría firmar una cancelación con el nombre de otra persona.
  const result = await cancelBooking(id, { reason, actor, refundCents });

  if (!result.ok) {
    const status = result.reason === 'NOT_FOUND' ? 404 : result.reason === 'BAD_STATE' ? 409 : 400;
    return fail(result.message, status);
  }

  return NextResponse.json({
    ok: true,
    code: result.code,
    status: result.status,
    refundedCents: result.refundedCents,
    alreadyCancelled: result.alreadyCancelled
  });
}
