import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { render, type DatosCorreo } from '@/lib/email-template';

/**
 * Envío de correos con Resend.
 *
 * Se habla con su API por HTTP y no con un SDK: una dependencia menos que
 * mantener, y la API son tres campos.
 *
 * El envío NUNCA debe tumbar una reserva. Si Resend falla o la clave no está
 * puesta, se registra el fallo y se sigue: el dinero ya entró y el boleto es
 * válido aunque el correo no salga. Perder una venta por un correo sería
 * mucho peor que un correo perdido.
 *
 * Lo mismo vale para la bitácora (EmailLog): es un registro para poder
 * contestar "¿le llegó o no?", no parte del flujo de cobro. Si escribirla
 * falla, se avisa en consola y el envío sigue su curso.
 */

const RESEND_URL = 'https://api.resend.com/emails';

/** La clave de la plantilla es también el `kind` que queda en la bitácora. */
export type TipoCorreo = 'booking_confirmation' | 'booking_reminder';

export interface ResultadoEnvio {
  ok: boolean;
  skipped?: 'NO_API_KEY' | 'NO_TEMPLATE';
  id?: string;
  error?: string;
}

const RESERVA_INCLUDE = {
  items: true,
  flight: { include: { experience: { include: { season: true } } } }
} satisfies Prisma.BookingInclude;

type Reserva = Prisma.BookingGetPayload<{ include: typeof RESERVA_INCLUDE }>;

function remitente(): string {
  // Debe ser un dominio verificado en Resend.
  const from = process.env['MAIL_FROM'] ?? 'Dinner in the Sky <reservas@dinnerinthesky.com.mx>';
  return from;
}

/**
 * Plantilla vigente: la de la temporada y, si no hay, la general. Es la misma
 * jerarquía para todos los tipos de correo, y por eso vive en un solo lugar.
 */
export async function buscarPlantilla(key: TipoCorreo, seasonId: string) {
  return (
    (await prisma.emailTemplate.findFirst({ where: { key, seasonId, active: true } })) ??
    (await prisma.emailTemplate.findFirst({ where: { key, seasonId: null, active: true } }))
  );
}

function datosDeReserva(booking: Reserva): DatosCorreo {
  const season = booking.flight.experience.season;

  // Las fechas se guardan en UTC; se muestran en la zona de la temporada
  // porque es la hora que el cliente vive en el lugar.
  const fecha = new Intl.DateTimeFormat('es-MX', {
    timeZone: season.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(booking.flight.startsAt);

  const hora = new Intl.DateTimeFormat('es-MX', {
    timeZone: season.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(booking.flight.startsAt);

  return {
    name: booking.customerName,
    booking_id: booking.code,
    product_name: booking.flight.experience.name,
    date_event: fecha,
    time_event: hora,
    seats: String(booking.seats),
    total: `${(booking.amountCents / 100).toLocaleString('es-MX', {
      style: 'currency',
      currency: booking.currency,
      maximumFractionDigits: 0
    })} ${booking.currency}`,
    venue_name: season.venueName ?? '',
    venue_address: season.venueAddress ?? '',
    email: booking.customerEmail,
    phone: booking.customerPhone ?? '',
    company_email: process.env['COMPANY_EMAIL'] ?? 'reservas@dinnerinthesky.com.mx',
    company_phone: process.env['COMPANY_PHONE'] ?? '+52 55 4506 4656'
  };
}

interface EntradaBitacora {
  kind: TipoCorreo;
  bookingId: string;
  toEmail: string;
  subject: string;
  ok: boolean;
  providerId?: string;
  error?: string;
  sentBy: string | null;
}

/**
 * Anota el envío. Nunca lanza: una reserva pagada pesa más que su bitácora.
 * El riesgo asumido es que un correo salga sin quedar registrado; en el
 * recordatorio eso podría repetirse, y por eso el fallo se deja en consola
 * con el código de la reserva para poder conciliarlo a mano.
 */
async function registrar(entrada: EntradaBitacora): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        kind: entrada.kind,
        bookingId: entrada.bookingId,
        toEmail: entrada.toEmail,
        subject: entrada.subject,
        ok: entrada.ok,
        providerId: entrada.providerId ?? null,
        error: entrada.error ?? null,
        sentBy: entrada.sentBy
      }
    });
  } catch (error) {
    console.error(
      `[mailer] No se pudo escribir la bitácora (${entrada.kind}, reserva ${entrada.bookingId}, ok=${entrada.ok}):`,
      error
    );
  }
}

/**
 * Camino común de todos los correos de reserva.
 *
 * Los envíos omitidos también se registran (con ok=false y la razón en
 * `error`): "no hay clave de Resend" o "no hay plantilla" son justo la
 * respuesta que el equipo necesita cuando un cliente dice que no recibió
 * nada. Si no quedaran anotados, la bitácora afirmaría por omisión que
 * nunca se intentó. Como ok=false, no cuentan como recordatorio enviado.
 *
 * No se registra el caso "la reserva no existe": no hay a qué colgarlo.
 */
async function enviarCorreoDeReserva(
  kind: TipoCorreo,
  bookingId: string,
  sentBy: string | null
): Promise<ResultadoEnvio> {
  const apiKey = process.env['RESEND_API_KEY'];

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: RESERVA_INCLUDE
  });

  if (!booking) {
    return { ok: false, error: 'La reserva no existe.' };
  }

  const plantilla = await buscarPlantilla(kind, booking.flight.experience.season.id);

  if (!plantilla) {
    // Sin plantilla no se inventa un texto: un correo improvisado a un
    // cliente es peor que ninguno. Aún no hay asunto renderizado, por eso
    // queda vacío en la bitácora.
    const error = `No hay plantilla configurada para "${kind}".`;
    await registrar({ kind, bookingId, toEmail: booking.customerEmail, subject: '', ok: false, error, sentBy });
    return { ok: false, skipped: 'NO_TEMPLATE', error };
  }

  const datos = datosDeReserva(booking);
  const subject = render(plantilla.subject, datos);
  const html = render(plantilla.bodyHtml, datos);

  if (!apiKey) {
    // Sin clave no se envía, pero tampoco se rompe: útil en desarrollo.
    console.info(`[mailer] RESEND_API_KEY no configurada; no se envió ${kind} de ${booking.code}.`);
    await registrar({
      kind,
      bookingId,
      toEmail: booking.customerEmail,
      subject,
      ok: false,
      error: 'RESEND_API_KEY no configurada: el correo no se envió.',
      sentBy
    });
    return { ok: false, skipped: 'NO_API_KEY' };
  }

  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: remitente(),
        to: [booking.customerEmail],
        // Copia al buzón de reservas, como hacía TuriTop con "envíame una
        // copia de todas las reservas".
        bcc: process.env['MAIL_BCC'] ? [process.env['MAIL_BCC']] : undefined,
        reply_to: process.env['COMPANY_EMAIL'] ?? 'reservas@dinnerinthesky.com.mx',
        subject,
        html
      })
    });

    const payload = (await response.json()) as { id?: string; message?: string };

    if (!response.ok) {
      const error = payload.message ?? `HTTP ${response.status}`;
      console.error(`[mailer] Resend respondió ${response.status}: ${payload.message ?? 'sin detalle'}`);
      await registrar({ kind, bookingId, toEmail: booking.customerEmail, subject, ok: false, error, sentBy });
      return { ok: false, error };
    }

    await registrar({
      kind,
      bookingId,
      toEmail: booking.customerEmail,
      subject,
      ok: true,
      providerId: payload.id,
      sentBy
    });
    return { ok: true, id: payload.id };
  } catch (error) {
    console.error('[mailer] No se pudo contactar a Resend:', error);
    await registrar({
      kind,
      bookingId,
      toEmail: booking.customerEmail,
      subject,
      ok: false,
      error: String(error),
      sentBy
    });
    return { ok: false, error: String(error) };
  }
}

/**
 * Manda el correo de confirmación de una reserva.
 *
 * `sentBy` es opcional para no cambiar la firma que ya usa lib/booking.ts:
 * la confirmación automática no lo pasa y queda como envío del sistema.
 */
export async function sendBookingConfirmation(
  bookingId: string,
  sentBy: string | null = null
): Promise<ResultadoEnvio> {
  return enviarCorreoDeReserva('booking_confirmation', bookingId, sentBy);
}

/**
 * Manda el recordatorio previo al vuelo. Siempre es una acción del staff, por
 * eso `sentBy` es obligatorio: debe salir del actor autenticado.
 *
 * Aquí NO se evita el duplicado: esa decisión depende de la bitácora y del
 * "reenviar de todos modos", y vive en el endpoint que orquesta el lote.
 */
export async function sendBookingReminder(bookingId: string, sentBy: string): Promise<ResultadoEnvio> {
  return enviarCorreoDeReserva('booking_reminder', bookingId, sentBy);
}
