import { prisma } from '@/lib/prisma';

/**
 * Códigos promocionales: validación y cálculo del descuento.
 *
 * Regla que no se negocia: **el importe final lo calcula siempre el
 * servidor**. El navegador manda el código tecleado, nunca el descuento ni
 * el total. Confiar en un total que llega del cliente es dejar que cualquiera
 * compre a un peso editando la petición.
 *
 * El redondeo siempre favorece al cliente (se redondea el descuento hacia
 * arriba): en un porcentaje con centavos partidos, el peso de diferencia es
 * nuestro, no suyo.
 */

export type PromoRejection =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'EXHAUSTED'
  | 'MIN_SEATS'
  | 'WRONG_SEASON'
  | 'WRONG_EXPERIENCE';

export interface PromoApplied {
  ok: true;
  promoCodeId: string;
  code: string;
  kind: string;
  description: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** Solo en FREE_SEATS: cuántos lugares salen gratis. */
  freeSeats: number;
}

export interface PromoRejected {
  ok: false;
  reason: PromoRejection;
  message: string;
}

const MENSAJES: Record<PromoRejection, string> = {
  NOT_FOUND: 'Ese código no existe.',
  INACTIVE: 'Ese código ya no está disponible.',
  NOT_STARTED: 'Ese código todavía no es válido.',
  EXPIRED: 'Ese código ya venció.',
  EXHAUSTED: 'Ese código ya se agotó.',
  MIN_SEATS: 'Ese código necesita más lugares para aplicar.',
  WRONG_SEASON: 'Ese código no aplica para esta temporada.',
  WRONG_EXPERIENCE: 'Ese código no aplica para esta experiencia.'
};

function rechazo(reason: PromoRejection): PromoRejected {
  return { ok: false, reason, message: MENSAJES[reason] };
}

/** Normaliza como se teclea: mayúsculas, sin espacios ni guiones sueltos. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export interface PromoContext {
  seats: number;
  unitPriceCents: number;
  seasonId: string;
  experienceId: string;
}

/**
 * Busca el código y calcula el descuento para un contexto concreto.
 *
 * No consume el canje: eso ocurre al confirmar el pago. Así, consultar el
 * código en la pantalla de compra no gasta un uso de una promoción limitada.
 */
export async function applyPromo(rawCode: string, ctx: PromoContext): Promise<PromoApplied | PromoRejected> {
  const code = normalizeCode(rawCode);
  if (!code) {
    return rechazo('NOT_FOUND');
  }

  const promo = await prisma.promoCode.findUnique({ where: { code } });
  if (!promo) {
    return rechazo('NOT_FOUND');
  }
  if (!promo.active) {
    return rechazo('INACTIVE');
  }

  const ahora = new Date();
  if (promo.validFrom && promo.validFrom > ahora) {
    return rechazo('NOT_STARTED');
  }
  if (promo.validUntil && promo.validUntil < ahora) {
    return rechazo('EXPIRED');
  }
  if (promo.maxRedemptions !== null && promo.timesRedeemed >= promo.maxRedemptions) {
    return rechazo('EXHAUSTED');
  }
  if (ctx.seats < promo.minSeats) {
    return rechazo('MIN_SEATS');
  }
  if (promo.seasonId && promo.seasonId !== ctx.seasonId) {
    return rechazo('WRONG_SEASON');
  }
  if (promo.experienceId && promo.experienceId !== ctx.experienceId) {
    return rechazo('WRONG_EXPERIENCE');
  }

  const subtotalCents = ctx.unitPriceCents * ctx.seats;
  let discountCents = 0;
  let freeSeats = 0;

  switch (promo.kind) {
    case 'PERCENT': {
      const pct = Math.min(100, Math.max(0, promo.value));
      discountCents = Math.ceil((subtotalCents * pct) / 100);
      break;
    }
    case 'FIXED': {
      discountCents = promo.value;
      break;
    }
    case 'FREE_SEATS': {
      // Por cada bloque de (pagados + gratis) se regalan `value` lugares.
      // Un 2x1 es buyRequired 1 y value 1: de cada dos lugares, uno gratis.
      const bloque = promo.buyRequired + promo.value;
      freeSeats = Math.floor(ctx.seats / bloque) * promo.value;
      discountCents = freeSeats * ctx.unitPriceCents;
      break;
    }
    case 'FULL_COMP': {
      discountCents = subtotalCents;
      freeSeats = ctx.seats;
      break;
    }
  }

  // El descuento nunca supera el subtotal: un código de $500 en una compra de
  // $350 no puede dejar un total negativo.
  discountCents = Math.max(0, Math.min(discountCents, subtotalCents));

  return {
    ok: true,
    promoCodeId: promo.id,
    code: promo.code,
    kind: promo.kind,
    description: promo.description,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    freeSeats
  };
}

/**
 * Consume un canje. Se llama al confirmar el pago, no al validar.
 *
 * El incremento es condicional para que dos compras simultáneas no puedan
 * pasarse del límite: si ya no queda cupo, afecta cero filas y el canje no
 * se registra. Es el mismo criterio que con los asientos.
 */
export async function redeemPromo(promoCodeId: string): Promise<boolean> {
  const afectadas = await prisma.$executeRaw`
    UPDATE "promo_codes"
    SET "timesRedeemed" = "timesRedeemed" + 1, "updatedAt" = now()
    WHERE "id" = ${promoCodeId}
      AND ("maxRedemptions" IS NULL OR "timesRedeemed" < "maxRedemptions")
  `;
  return afectadas > 0;
}
