import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/bookings — listado de reservas para el staff.
 *
 * Filtros: ?seasonId= ?status= ?q= (código, nombre, correo o teléfono)
 * ?from= ?to= (fecha del vuelo) ?page=
 *
 * Aquí SÍ se devuelven datos de contacto: es la pantalla desde la que el
 * equipo llama a un cliente cuando el clima mueve un vuelo. Por eso exige
 * sesión y nunca es pública.
 */
const PAGE_SIZE = 50;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get('seasonId')?.trim();
  const status = searchParams.get('status')?.trim().toUpperCase();
  const q = searchParams.get('q')?.trim();
  const from = searchParams.get('from')?.trim();
  const to = searchParams.get('to')?.trim();
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);

  const where: Prisma.BookingWhereInput = {};

  if (seasonId) {
    where.flight = { experience: { seasonId } };
  }
  if (status && status !== 'ALL') {
    where.status = status as Prisma.EnumBookingStatusFilter['equals'];
  }
  if (q) {
    // Búsqueda amplia: el staff tiene en la mano un código, un nombre o un
    // correo, según por dónde le llegue la consulta.
    where.OR = [
      { code: { contains: q, mode: 'insensitive' } },
      { customerName: { contains: q, mode: 'insensitive' } },
      { customerEmail: { contains: q, mode: 'insensitive' } },
      { customerPhone: { contains: q } }
    ];
  }
  if (from || to) {
    const rango: Prisma.DateTimeFilter = {};
    if (from) rango.gte = new Date(`${from}T00:00:00.000Z`);
    if (to) rango.lte = new Date(`${to}T23:59:59.999Z`);
    where.flight = { ...(where.flight as object), startsAt: rango };
  }

  const [total, bookings, resumen] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        items: true,
        flight: { include: { experience: { include: { season: true } } } }
      }
    }),
    // El total vendido solo cuenta lo confirmado: lo pendiente puede
    // expirar y contarlo infla la cifra.
    prisma.booking.aggregate({
      where: { ...where, status: 'CONFIRMED' },
      _sum: { amountCents: true, seats: true },
      _count: true
    })
  ]);

  return NextResponse.json({
    ok: true,
    page,
    pageSize: PAGE_SIZE,
    total,
    summary: {
      confirmed: resumen._count,
      seats: resumen._sum.seats ?? 0,
      amountCents: resumen._sum.amountCents ?? 0
    },
    bookings: bookings.map(b => ({
      id: b.id,
      code: b.code,
      status: b.status,
      seats: b.seats,
      amountCents: b.amountCents,
      subtotalCents: b.subtotalCents,
      discountCents: b.discountCents,
      promoCodeUsed: b.promoCodeUsed,
      currency: b.currency,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      customerPhone: b.customerPhone,
      invoiceRequested: b.invoiceRequested,
      preferences: b.preferences,
      channel: b.channel,
      createdAt: b.createdAt,
      confirmedAt: b.confirmedAt,
      flight: {
        id: b.flight.id,
        startsAt: b.flight.startsAt,
        experience: b.flight.experience.name,
        season: b.flight.experience.season.name,
        timezone: b.flight.experience.season.timezone
      },
      items: b.items.map(i => ({
        name: i.nameAtPurchase,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents
      }))
    }))
  });
}
