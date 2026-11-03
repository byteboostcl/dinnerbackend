import { NextResponse } from 'next/server';
import { confirmBooking } from '@/lib/booking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/booking/confirm-test — confirma una reserva SIN cobrar.
 *
 * Existe solo para probar el flujo completo mientras Stripe no está
 * conectado. Cuando el pago real esté en su sitio, este archivo se borra.
 *
 * Doble cerrojo para que no pueda usarse en producción:
 *  1. NODE_ENV distinto de production.
 *  2. ALLOW_TEST_CHECKOUT activada a mano.
 *
 * Si alguno falla, responde 404 — ni siquiera admite que la ruta existe.
 */
export async function POST(request: Request): Promise<Response> {
  const enabled = process.env.NODE_ENV !== 'production' && process.env['ALLOW_TEST_CHECKOUT'] === 'true';

  if (!enabled) {
    return NextResponse.json({ ok: false, error: 'No encontrado.' }, { status: 404 });
  }

  let body: { bookingId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
  if (!bookingId) {
    return NextResponse.json({ ok: false, error: 'Falta bookingId.' }, { status: 400 });
  }

  const result = await confirmBooking(bookingId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.message }, { status: 409 });
  }

  return NextResponse.json({ ok: true, code: result.code, alreadyConfirmed: result.alreadyConfirmed, test: true });
}
