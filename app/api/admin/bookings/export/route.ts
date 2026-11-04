import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/bookings/export — reservas en .xlsx para el staff.
 *
 * Mismos filtros que el listado: ?seasonId= ?status= ?from= ?to= (fecha del
 * vuelo). Los importes salen en pesos; en la base siempre son centavos.
 */
const ESTADOS: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  REFUNDED: 'Reembolsada',
  EXPIRED: 'Expirada'
};

function formatoFecha(fecha: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(fecha);
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get('seasonId')?.trim();
  const status = searchParams.get('status')?.trim().toUpperCase();
  const from = searchParams.get('from')?.trim();
  const to = searchParams.get('to')?.trim();

  const where: Prisma.BookingWhereInput = {};
  if (seasonId) {
    where.flight = { experience: { seasonId } };
  }
  if (status && status !== 'ALL') {
    where.status = status as Prisma.EnumBookingStatusFilter['equals'];
  }
  if (from || to) {
    const rango: Prisma.DateTimeFilter = {};
    if (from) rango.gte = new Date(`${from}T00:00:00.000Z`);
    if (to) rango.lte = new Date(`${to}T23:59:59.999Z`);
    where.flight = { ...(where.flight as object), startsAt: rango };
  }

  const bookings = await prisma.booking.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { flight: { include: { experience: { include: { season: true } } } } }
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Reservas');

  sheet.columns = [
    { header: 'Código', key: 'code', width: 16 },
    { header: 'Estado', key: 'status', width: 14 },
    { header: 'Cliente', key: 'customerName', width: 28 },
    { header: 'Correo', key: 'customerEmail', width: 30 },
    { header: 'Teléfono', key: 'customerPhone', width: 18 },
    { header: 'Experiencia', key: 'experience', width: 26 },
    { header: 'Fecha del vuelo', key: 'flightDate', width: 24 },
    { header: 'Lugares', key: 'seats', width: 10 },
    { header: 'Subtotal', key: 'subtotal', width: 14 },
    { header: 'Descuento', key: 'discount', width: 14 },
    { header: 'Código promo', key: 'promo', width: 16 },
    { header: 'Total', key: 'total', width: 14 },
    { header: 'Pidió factura', key: 'invoice', width: 14 },
    { header: 'Canal', key: 'channel', width: 14 },
    { header: 'Creada', key: 'createdAt', width: 24 }
  ];
  sheet.getRow(1).font = { bold: true };
  for (const key of ['subtotal', 'discount', 'total']) {
    sheet.getColumn(key).numFmt = '"$"#,##0.00';
  }

  for (const b of bookings) {
    const timezone = b.flight.experience.season.timezone;
    sheet.addRow({
      code: b.code,
      status: ESTADOS[b.status] ?? b.status,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      customerPhone: b.customerPhone,
      experience: b.flight.experience.name,
      flightDate: formatoFecha(b.flight.startsAt, timezone),
      seats: b.seats,
      // Reservas antiguas no guardaron subtotal: se deja la celda vacía en vez de inventarlo.
      subtotal: b.subtotalCents === null ? null : b.subtotalCents / 100,
      discount: b.discountCents / 100,
      promo: b.promoCodeUsed ?? '',
      total: b.amountCents / 100,
      invoice: b.invoiceRequested ? 'Sí' : 'No',
      channel: b.channel,
      createdAt: formatoFecha(b.createdAt, timezone)
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const fecha = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="reservas-${fecha}.xlsx"`
    }
  });
}
