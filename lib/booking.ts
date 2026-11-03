import { randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { applyPromo, redeemPromo } from '@/lib/promo';

/**
 * Reserva de lugares.
 *
 * La pieza delicada de todo el sistema: que dos personas no puedan comprar el
 * mismo último asiento. Se resuelve con un UPDATE condicional, no leyendo y
 * después escribiendo:
 *
 *   UPDATE flights SET "seatsTaken" = "seatsTaken" + n
 *   WHERE id = ? AND "seatsTaken" + n <= capacity
 *
 * Postgres evalúa esa condición con la fila bloqueada, así que de dos
 * peticiones simultáneas por el último lugar, una afecta 1 fila y la otra 0.
 * La que afecta 0 se queda sin cupo. Leer primero y escribir después deja una
 * ventana —de milisegundos, pero real— en la que ambas creen que hay sitio.
 */

/** Minutos que se guardan los lugares mientras la persona paga. */
export const HOLD_MINUTES = 20;

/** Sin vocales ni caracteres que se confundan al dictarlos por teléfono. */
const CODE_ALPHABET = '23456789ACDEFGHJKLMNPQRSTUVWXYZ';

function bookingCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return `DITS-${code}`;
}

/** Una línea del carrito: qué se compra y cuántos. */
export interface HoldLine {
  ticketTypeId: string;
  quantity: number;
}

export interface HoldRequest {
  flightId: string;
  /**
   * Líneas de la compra. El precio y los asientos NO vienen de aquí: se leen
   * de la base. Lo único que decide el navegador es qué y cuánto.
   */
  lines: HoldLine[];
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  invoiceRequested?: boolean;
  /** Código tal como lo tecleó la persona; el descuento se calcula aquí. */
  promoCode?: string | null;
}

export type HoldResult =
  | {
      ok: true;
      bookingId: string;
      code: string;
      amountCents: number;
      subtotalCents: number;
      discountCents: number;
      promoCode: string | null;
      currency: string;
      holdExpiresAt: Date;
    }
  | {
      ok: false;
      reason:
        | 'FLIGHT_NOT_FOUND'
        | 'FLIGHT_CLOSED'
        | 'FLIGHT_PAST'
        | 'NO_SEATS'
        | 'EMPTY_CART'
        | 'BAD_TICKET'
        | 'LIMIT';
      message: string;
    };

/**
 * Aparta lugares y crea la reserva en estado PENDING.
 *
 * Todo ocurre dentro de una transacción: si falla la creación de la reserva,
 * los lugares vuelven solos. Sin transacción podrían quedar asientos
 * ocupados por una reserva que no existe.
 */
export async function holdSeats(request: HoldRequest): Promise<HoldResult> {
  const { flightId } = request;

  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    include: {
      experience: {
        include: { season: true, ticketTypes: { where: { active: true } } }
      }
    }
  });

  if (!flight) {
    return { ok: false, reason: 'FLIGHT_NOT_FOUND', message: 'Ese horario no existe.' };
  }
  if (flight.status !== 'SCHEDULED') {
    return { ok: false, reason: 'FLIGHT_CLOSED', message: 'Ese horario ya no está disponible.' };
  }
  if (flight.startsAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'FLIGHT_PAST', message: 'Ese vuelo ya salió.' };
  }

  // Se arma el carrito contra la base: precios, asientos y límites salen de
  // los tipos de ticket, nunca del navegador.
  const lineas: { ticketType: (typeof flight.experience.ticketTypes)[number]; quantity: number }[] = [];

  for (const linea of request.lines ?? []) {
    if (!Number.isInteger(linea.quantity) || linea.quantity <= 0) {
      continue;
    }
    const ticketType = flight.experience.ticketTypes.find(t => t.id === linea.ticketTypeId);
    if (!ticketType) {
      return { ok: false, reason: 'BAD_TICKET', message: 'Uno de los boletos elegidos ya no está disponible.' };
    }
    if (ticketType.maxPerBooking !== null && linea.quantity > ticketType.maxPerBooking) {
      return {
        ok: false,
        reason: 'LIMIT',
        message: `Solo se puede agregar ${ticketType.maxPerBooking} de "${ticketType.name}" por reserva.`
      };
    }
    lineas.push({ ticketType, quantity: linea.quantity });
  }

  if (lineas.length === 0) {
    return { ok: false, reason: 'EMPTY_CART', message: 'No elegiste ningún boleto.' };
  }

  // Solo los tickets que ocupan asiento consumen cupo; los extras no.
  const seats = lineas.reduce((total, l) => total + (l.ticketType.occupiesSeat ? l.quantity : 0), 0);
  if (seats === 0) {
    return { ok: false, reason: 'EMPTY_CART', message: 'Agrega al menos un lugar para la mesa.' };
  }

  const subtotalCents = lineas.reduce((total, l) => total + l.ticketType.priceCents * l.quantity, 0);
  const currency = flight.experience.season.currency;
  const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);

  // El descuento se recalcula aquí aunque la pantalla ya lo haya mostrado:
  // lo único que viaja desde el navegador es el código tecleado, nunca el
  // importe. Si el código venció entre la consulta y el pago, se cobra el
  // precio completo en vez de fallar.
  let discountCents = 0;
  let promoCodeId: string | null = null;
  let promoCodeUsed: string | null = null;

  if (request.promoCode) {
    const promo = await applyPromo(request.promoCode, {
      seats,
      unitPriceCents: Math.round(subtotalCents / seats),
      seasonId: flight.experience.seasonId,
      experienceId: flight.experienceId
    });
    if (promo.ok) {
      discountCents = promo.discountCents;
      promoCodeId = promo.promoCodeId;
      promoCodeUsed = promo.code;
    }
  }

  const amountCents = subtotalCents - discountCents;

  try {
    return await prisma.$transaction(async tx => {
      // El corazón: condicional y atómico. Si no caben, afecta 0 filas.
      const affected = await tx.$executeRaw`
        UPDATE "flights"
        SET "seatsTaken" = "seatsTaken" + ${seats}, "updatedAt" = now()
        WHERE "id" = ${flightId}
          AND "status" = 'SCHEDULED'
          AND "seatsTaken" + ${seats} <= "capacity"
      `;

      if (affected === 0) {
        return {
          ok: false as const,
          reason: 'NO_SEATS' as const,
          message: 'Ya no quedan suficientes lugares en ese horario.'
        };
      }

      const booking = await tx.booking.create({
        data: {
          code: bookingCode(),
          flightId,
          seats,
          customerName: request.customerName,
          customerEmail: request.customerEmail,
          customerPhone: request.customerPhone ?? null,
          amountCents,
          subtotalCents,
          discountCents,
          promoCodeId,
          promoCodeUsed,
          currency,
          status: 'PENDING',
          holdExpiresAt,
          invoiceRequested: request.invoiceRequested ?? false,
          items: {
            create: lineas.map(l => ({
              ticketTypeId: l.ticketType.id,
              nameAtPurchase: l.ticketType.name,
              unitPriceCents: l.ticketType.priceCents,
              quantity: l.quantity,
              seats: l.ticketType.occupiesSeat ? l.quantity : 0
            }))
          }
        }
      });

      return {
        ok: true as const,
        bookingId: booking.id,
        code: booking.code,
        amountCents,
        subtotalCents,
        discountCents,
        promoCode: promoCodeUsed,
        currency,
        holdExpiresAt
      };
    });
  } catch (error) {
    // Choque de código de reserva: improbable (31^6 combinaciones) pero
    // posible. Se reintenta una vez antes de rendirse.
    if (String(error).includes('bookings_code_key')) {
      return holdSeats(request);
    }
    throw error;
  }
}

/**
 * Confirma una reserva ya pagada y emite sus boletos.
 *
 * Idempotente: si ya estaba confirmada, devuelve lo mismo sin duplicar
 * boletos. Los webhooks de Stripe se reintentan, así que esto se va a llamar
 * más de una vez con el mismo pago.
 */
export async function confirmBooking(
  bookingId: string,
  payment?: { stripePaymentIntentId?: string; stripeSessionId?: string }
): Promise<{ ok: true; code: string; alreadyConfirmed: boolean } | { ok: false; message: string }> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { tickets: true } });

  if (!booking) {
    return { ok: false, message: 'La reserva no existe.' };
  }
  if (booking.status === 'CONFIRMED') {
    return { ok: true, code: booking.code, alreadyConfirmed: true };
  }
  if (booking.status !== 'PENDING') {
    return { ok: false, message: `La reserva está ${booking.status} y no se puede confirmar.` };
  }

  await prisma.$transaction(async tx => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        holdExpiresAt: null,
        stripePaymentIntentId: payment?.stripePaymentIntentId ?? undefined,
        stripeSessionId: payment?.stripeSessionId ?? undefined
      }
    });

    if (booking.promoCodeId) {
      await redeemPromo(booking.promoCodeId);
    }

    // Un boleto por asiento, cada uno con su propio secreto para el QR.
    if (booking.tickets.length === 0) {
      await tx.ticket.createMany({
        data: Array.from({ length: booking.seats }, () => ({
          bookingId,
          qrToken: `${randomUUID()}${randomBytes(8).toString('hex')}`
        }))
      });
    }
  });

  return { ok: true, code: booking.code, alreadyConfirmed: false };
}

/**
 * Libera los apartados vencidos y devuelve sus lugares.
 *
 * Se llama antes de consultar disponibilidad: así los lugares de un carrito
 * abandonado vuelven a la venta sin depender de un proceso programado, que
 * en este hosting no existe.
 */
export async function releaseExpiredHolds(): Promise<number> {
  const expired = await prisma.booking.findMany({
    where: { status: 'PENDING', holdExpiresAt: { lt: new Date() } },
    select: { id: true, flightId: true, seats: true }
  });

  if (expired.length === 0) {
    return 0;
  }

  await prisma.$transaction(async tx => {
    for (const booking of expired) {
      await tx.$executeRaw`
        UPDATE "flights"
        SET "seatsTaken" = GREATEST(0, "seatsTaken" - ${booking.seats}), "updatedAt" = now()
        WHERE "id" = ${booking.flightId}
      `;
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } });
    }
  });

  return expired.length;
}
