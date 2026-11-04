import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/email-logs — bitácora de correos enviados por el sistema.
 *
 * Filtros: ?kind= ?bookingId= ?email= ?q= (correo o código de reserva)
 * ?status=ok|failed ?from= ?to= (YYYY-MM-DD, fecha del envío en UTC) ?page=
 *
 * Es solo lectura a propósito: la bitácora es la prueba de qué se le mandó
 * a quién, y no debe existir una vía para borrarla desde el panel.
 */
const PAGE_SIZE = 50;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('kind')?.trim();
  const bookingId = searchParams.get('bookingId')?.trim();
  const email = searchParams.get('email')?.trim();
  const q = searchParams.get('q')?.trim();
  const status = searchParams.get('status')?.trim().toLowerCase();
  const from = searchParams.get('from')?.trim();
  const to = searchParams.get('to')?.trim();
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);

  // Una fecha mal formada daría un Date inválido y Prisma lanzaría un 500;
  // es mejor decirle al llamador qué falló.
  if ((from && !FECHA.test(from)) || (to && !FECHA.test(to))) {
    return NextResponse.json({ ok: false, error: 'Las fechas deben ir como AAAA-MM-DD.' }, { status: 400 });
  }
  if (status && status !== 'ok' && status !== 'failed' && status !== 'all') {
    return NextResponse.json({ ok: false, error: 'status debe ser ok, failed o all.' }, { status: 400 });
  }

  const where: Prisma.EmailLogWhereInput = {};

  if (kind && kind !== 'all') where.kind = kind;
  if (bookingId) where.bookingId = bookingId;
  if (email) where.toEmail = { contains: email, mode: 'insensitive' };
  if (status === 'ok') where.ok = true;
  if (status === 'failed') where.ok = false;
  if (q) {
    where.OR = [
      { toEmail: { contains: q, mode: 'insensitive' } },
      { booking: { code: { contains: q, mode: 'insensitive' } } }
    ];
  }
  if (from || to) {
    const rango: Prisma.DateTimeFilter = {};
    if (from) rango.gte = new Date(`${from}T00:00:00.000Z`);
    if (to) rango.lte = new Date(`${to}T23:59:59.999Z`);
    where.createdAt = rango;
  }

  const [total, failed, logs] = await Promise.all([
    prisma.emailLog.count({ where }),
    // Cuántos fallaron dentro del mismo filtro: es la cifra que el equipo
    // busca primero al abrir la pantalla.
    prisma.emailLog.count({ where: { ...where, ok: false } }),
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        booking: {
          select: {
            id: true,
            code: true,
            customerName: true,
            flight: { select: { experience: { select: { season: { select: { timezone: true } } } } } }
          }
        }
      }
    })
  ]);

  return NextResponse.json({
    ok: true,
    page,
    pageSize: PAGE_SIZE,
    total,
    failed,
    logs: logs.map(l => ({
      id: l.id,
      kind: l.kind,
      toEmail: l.toEmail,
      subject: l.subject,
      ok: l.ok,
      providerId: l.providerId,
      error: l.error,
      sentBy: l.sentBy,
      createdAt: l.createdAt,
      booking: l.booking
        ? {
            id: l.booking.id,
            code: l.booking.code,
            customerName: l.booking.customerName,
            timezone: l.booking.flight.experience.season.timezone
          }
        : null
    }))
  });
}
