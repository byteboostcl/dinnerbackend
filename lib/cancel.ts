import { prisma } from '@/lib/prisma';

/**
 * Cancelación de reservas hecha por el equipo.
 *
 * Una reserva vendida nunca se borra: se cancela y queda el rastro de quién,
 * cuándo y por qué. Cancelar tiene tres efectos que deben ocurrir juntos o no
 * ocurrir: cambiar el estado, devolver los lugares al vuelo y, si ya se había
 * pagado con un código, devolver el uso de ese código. Por eso van en una sola
 * transacción: sin ella, una falla a la mitad dejaría una reserva cancelada
 * con sus lugares todavía bloqueados, que es dinero perdido en sillas vacías.
 */

export interface CancelOptions {
  /** Motivo en palabras del equipo; sin él, meses después nadie explica un reembolso. */
  reason: string;
  /** Quién cancela, tomado de la sesión. Nunca del body de la petición. */
  actor: string;
  /** Centavos que el equipo reembolsó por fuera. Omitido o 0 = sin reembolso. */
  refundCents?: number;
}

export type CancelResult =
  | { ok: true; code: string; status: 'CANCELLED' | 'REFUNDED'; refundedCents: number; alreadyCancelled: boolean }
  | {
      ok: false;
      reason: 'NOT_FOUND' | 'BAD_REASON' | 'BAD_REFUND' | 'BAD_STATE';
      message: string;
    };

/**
 * Cancela una reserva PENDING o CONFIRMED.
 *
 * Idempotente, igual que confirmBooking: si ya estaba cancelada (o
 * reembolsada, que es una cancelación con dinero de vuelta) responde ok sin
 * tocar nada. Devolver los lugares dos veces dejaría el vuelo con más
 * disponibilidad de la real, así que repetir la petición no puede repetir el
 * efecto.
 *
 * NOTA: no hay integración con Stripe. `refundCents` es el registro de que el
 * equipo ya hizo el reembolso por fuera (panel de Stripe, transferencia); esta
 * función no mueve dinero. Cuando exista el reembolso automático, aquí es donde
 * debe llamarse, antes de guardar el estado.
 */
export async function cancelBooking(bookingId: string, opts: CancelOptions): Promise<CancelResult> {
  const reason = opts.reason.trim();
  if (!reason) {
    return { ok: false, reason: 'BAD_REASON', message: 'Escribe el motivo de la cancelación.' };
  }

  const refundCents = opts.refundCents ?? 0;
  if (!Number.isInteger(refundCents) || refundCents < 0) {
    return { ok: false, reason: 'BAD_REFUND', message: 'El reembolso debe ser un importe en centavos, entero y no negativo.' };
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      code: true,
      status: true,
      flightId: true,
      seats: true,
      amountCents: true,
      promoCodeId: true,
      refundedCents: true
    }
  });

  if (!booking) {
    return { ok: false, reason: 'NOT_FOUND', message: 'La reserva no existe.' };
  }
  if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
    return {
      ok: true,
      code: booking.code,
      status: booking.status,
      refundedCents: booking.refundedCents,
      alreadyCancelled: true
    };
  }
  if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
    return { ok: false, reason: 'BAD_STATE', message: `La reserva está ${booking.status} y no se puede cancelar.` };
  }

  if (refundCents > booking.amountCents) {
    return { ok: false, reason: 'BAD_REFUND', message: 'El reembolso no puede ser mayor que lo que pagó el cliente.' };
  }
  // Una reserva PENDING nunca cobró nada: registrar un reembolso ahí
  // inventaría un movimiento de dinero que no existió.
  if (refundCents > 0 && booking.status !== 'CONFIRMED') {
    return { ok: false, reason: 'BAD_REFUND', message: 'Esta reserva no está pagada, así que no hay nada que reembolsar.' };
  }

  const status = refundCents > 0 ? ('REFUNDED' as const) : ('CANCELLED' as const);
  const statusAnterior = booking.status;

  return prisma.$transaction(async tx => {
    // El cambio de estado es la compuerta: condicionado al estado que se leyó,
    // de dos cancelaciones simultáneas solo una afecta la fila. La otra no
    // devuelve lugares ni usos por segunda vez.
    const cambiadas = await tx.booking.updateMany({
      where: { id: bookingId, status: statusAnterior },
      data: {
        status,
        cancelledAt: new Date(),
        cancelReason: reason,
        cancelledBy: opts.actor,
        refundedCents: refundCents,
        holdExpiresAt: null
      }
    });

    if (cambiadas.count === 0) {
      const actual = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { status: true, refundedCents: true }
      });
      if (actual && (actual.status === 'CANCELLED' || actual.status === 'REFUNDED')) {
        return {
          ok: true as const,
          code: booking.code,
          status: actual.status,
          refundedCents: actual.refundedCents,
          alreadyCancelled: true
        };
      }
      return {
        ok: false as const,
        reason: 'BAD_STATE' as const,
        message: 'La reserva cambió mientras se cancelaba. Revísala y vuelve a intentar.'
      };
    }

    // Mismo criterio que releaseExpiredHolds: UPDATE directo con GREATEST para
    // no leer-y-escribir. Un PENDING también tiene lugares apartados, así que
    // se devuelven en ambos estados.
    await tx.$executeRaw`
      UPDATE "flights"
      SET "seatsTaken" = GREATEST(0, "seatsTaken" - ${booking.seats}), "updatedAt" = now()
      WHERE "id" = ${booking.flightId}
    `;

    // El uso del código se consume en confirmBooking (redeemPromo), no al
    // apartar. Solo una reserva CONFIRMED lo gastó; devolver el de una PENDING
    // regalaría un uso que nunca se descontó.
    if (booking.promoCodeId && statusAnterior === 'CONFIRMED') {
      await tx.$executeRaw`
        UPDATE "promo_codes"
        SET "timesRedeemed" = "timesRedeemed" - 1, "updatedAt" = now()
        WHERE "id" = ${booking.promoCodeId}
          AND "timesRedeemed" > 0
      `;
    }

    return { ok: true as const, code: booking.code, status, refundedCents: refundCents, alreadyCancelled: false };
  });
}
