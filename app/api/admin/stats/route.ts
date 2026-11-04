import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/stats?seasonId= — resumen de ventas de una temporada.
 *
 * Todos los importes y conteos salen SOLO de reservas CONFIRMED: las
 * pendientes pueden expirar y contarlas infla la cifra de ventas.
 */
const DIAS_GRAFICA = 30;

/** Fecha 'YYYY-MM-DD' en la zona de la temporada, para que una venta de las 11 pm no caiga en el día siguiente (UTC). */
function diaEnZona(fecha: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(fecha);
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const seasonId = new URL(request.url).searchParams.get('seasonId')?.trim();
  if (!seasonId) {
    return NextResponse.json({ ok: false, error: 'Falta seasonId.' }, { status: 400 });
  }

  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { timezone: true }
  });
  if (!season) {
    return NextResponse.json({ ok: false, error: 'Temporada no encontrada.' }, { status: 404 });
  }

  const confirmadas: Prisma.BookingWhereInput = {
    status: 'CONFIRMED',
    flight: { experience: { seasonId } }
  };

  const desde = new Date(Date.now() - DIAS_GRAFICA * 24 * 60 * 60 * 1000);

  const [totales, capacidad, promos, reservas] = await Promise.all([
    prisma.booking.aggregate({
      where: confirmadas,
      _sum: { seats: true, amountCents: true, discountCents: true },
      _count: true
    }),
    // Un vuelo cancelado ya no ofrece lugares: dejarlo en la capacidad
    // bajaría la ocupación aparente.
    prisma.flight.aggregate({
      where: { experience: { seasonId }, status: { not: 'CANCELLED' } },
      _sum: { capacity: true }
    }),
    prisma.booking.groupBy({
      by: ['promoCodeUsed'],
      where: { ...confirmadas, promoCodeUsed: { not: null } },
      _count: true,
      _sum: { discountCents: true },
      orderBy: { _count: { promoCodeUsed: 'desc' } },
      take: 5
    }),
    // Prisma no agrupa por un campo de una relación, así que el desglose por
    // experiencia y por día se arma en JS sobre la temporada ya acotada.
    prisma.booking.findMany({
      where: confirmadas,
      select: {
        seats: true,
        amountCents: true,
        confirmedAt: true,
        createdAt: true,
        flight: { select: { experience: { select: { id: true, name: true } } } }
      }
    })
  ]);

  const lugaresVendidos = totales._sum.seats ?? 0;
  const capacidadTotal = capacidad._sum.capacity ?? 0;

  const porExperiencia = new Map<
    string,
    { name: string; bookings: number; seats: number; amountCents: number }
  >();
  const porDia = new Map<string, { bookings: number; amountCents: number }>();

  for (const r of reservas) {
    const exp = r.flight.experience;
    const fila = porExperiencia.get(exp.id) ?? {
      name: exp.name,
      bookings: 0,
      seats: 0,
      amountCents: 0
    };
    fila.bookings += 1;
    fila.seats += r.seats;
    fila.amountCents += r.amountCents;
    porExperiencia.set(exp.id, fila);

    const fechaVenta = r.confirmedAt ?? r.createdAt;
    if (fechaVenta >= desde) {
      const dia = diaEnZona(fechaVenta, season.timezone);
      const acumulado = porDia.get(dia) ?? { bookings: 0, amountCents: 0 };
      acumulado.bookings += 1;
      acumulado.amountCents += r.amountCents;
      porDia.set(dia, acumulado);
    }
  }

  // Se rellenan los días sin ventas para que la gráfica no salte fechas.
  const ventasPorDia = Array.from({ length: DIAS_GRAFICA }, (_, i) => {
    const dia = diaEnZona(
      new Date(Date.now() - (DIAS_GRAFICA - 1 - i) * 24 * 60 * 60 * 1000),
      season.timezone
    );
    return { date: dia, ...(porDia.get(dia) ?? { bookings: 0, amountCents: 0 }) };
  });

  return NextResponse.json({
    ok: true,
    totals: {
      bookings: totales._count,
      seats: lugaresVendidos,
      amountCents: totales._sum.amountCents ?? 0,
      discountCents: totales._sum.discountCents ?? 0
    },
    occupancy: {
      seatsSold: lugaresVendidos,
      capacity: capacidadTotal,
      percent: capacidadTotal > 0 ? Math.round((lugaresVendidos / capacidadTotal) * 1000) / 10 : 0
    },
    salesByDay: ventasPorDia,
    topPromoCodes: promos.map(p => ({
      code: p.promoCodeUsed,
      uses: p._count,
      discountCents: p._sum.discountCents ?? 0
    })),
    byExperience: Array.from(porExperiencia.values()).sort((a, b) => b.amountCents - a.amountCents)
  });
}
