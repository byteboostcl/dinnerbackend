import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { AdminPanel } from './AdminPanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Comprobación de sesión en el servidor: si no hay cookie válida, el panel
 * no llega siquiera a enviarse al navegador. Esconderlo con JavaScript sería
 * solo apariencia.
 */
export default async function AdminHome() {
  const session = await currentSession();
  if (!session) {
    redirect('/admin/login');
  }

  const seasons = await prisma.season.findMany({
    orderBy: { startsOn: 'desc' },
    include: {
      experiences: {
        orderBy: { position: 'asc' },
        include: {
          ticketTypes: { orderBy: [{ occupiesSeat: 'desc' }, { position: 'asc' }] },
          flights: {
            orderBy: { startsAt: 'asc' },
            include: { _count: { select: { bookings: true } } }
          }
        }
      }
    }
  });

  // Se serializa aquí para que el componente de cliente reciba datos planos
  // (las fechas de Prisma no cruzan tal cual la frontera servidor-cliente).
  const data = seasons.map(season => ({
    id: season.id,
    name: season.name,
    citySlug: season.citySlug,
    status: season.status,
    timezone: season.timezone,
    currency: season.currency,
    experiences: season.experiences.map(experience => ({
      id: experience.id,
      name: experience.name,
      slug: experience.slug,
      priceCents: experience.priceCents,
      ticketTypes: experience.ticketTypes.map(t => ({
        id: t.id,
        name: t.name,
        note: t.note,
        priceCents: t.priceCents,
        occupiesSeat: t.occupiesSeat,
        maxPerBooking: t.maxPerBooking,
        active: t.active
      })),
      flights: experience.flights.map(flight => ({
        id: flight.id,
        startsAt: flight.startsAt.toISOString(),
        capacity: flight.capacity,
        seatsTaken: flight.seatsTaken,
        status: flight.status,
        bookings: flight._count.bookings
      }))
    }))
  }));

  const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });

  return (
    <AdminPanel
      seasons={data}
      promos={promos.map(p => ({
        id: p.id,
        code: p.code,
        description: p.description,
        kind: p.kind,
        value: p.value,
        maxRedemptions: p.maxRedemptions,
        timesRedeemed: p.timesRedeemed,
        validUntil: p.validUntil ? p.validUntil.toISOString() : null,
        active: p.active
      }))}
      user={{ email: session.email, role: session.role }}
    />
  );
}
