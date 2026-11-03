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
 */

const RESEND_URL = 'https://api.resend.com/emails';

export interface ResultadoEnvio {
  ok: boolean;
  skipped?: 'NO_API_KEY' | 'NO_TEMPLATE';
  id?: string;
  error?: string;
}

function remitente(): string {
  // Debe ser un dominio verificado en Resend.
  const from = process.env['MAIL_FROM'] ?? 'Dinner in the Sky <reservas@dinnerinthesky.com.mx>';
  return from;
}

/**
 * Manda el correo de confirmación de una reserva.
 *
 * Busca primero la plantilla de la temporada y, si no hay, la general. Sin
 * plantilla no inventa un texto: avisa y no envía, porque un correo
 * improvisado a un cliente que acaba de pagar es peor que ninguno.
 */
export async function sendBookingConfirmation(bookingId: string): Promise<ResultadoEnvio> {
  const apiKey = process.env['RESEND_API_KEY'];

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: true,
      flight: { include: { experience: { include: { season: true } } } }
    }
  });

  if (!booking) {
    return { ok: false, error: 'La reserva no existe.' };
  }

  const season = booking.flight.experience.season;

  const plantilla =
    (await prisma.emailTemplate.findFirst({
      where: { key: 'booking_confirmation', seasonId: season.id, active: true }
    })) ??
    (await prisma.emailTemplate.findFirst({
      where: { key: 'booking_confirmation', seasonId: null, active: true }
    }));

  if (!plantilla) {
    return { ok: false, skipped: 'NO_TEMPLATE', error: 'No hay plantilla de confirmación configurada.' };
  }

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

  const datos: DatosCorreo = {
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

  const subject = render(plantilla.subject, datos);
  const html = render(plantilla.bodyHtml, datos);

  if (!apiKey) {
    // Sin clave no se envía, pero tampoco se rompe: útil en desarrollo.
    console.info(`[mailer] RESEND_API_KEY no configurada; no se envió la confirmación de ${booking.code}.`);
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
      console.error(`[mailer] Resend respondió ${response.status}: ${payload.message ?? 'sin detalle'}`);
      return { ok: false, error: payload.message ?? `HTTP ${response.status}` };
    }

    return { ok: true, id: payload.id };
  } catch (error) {
    console.error('[mailer] No se pudo contactar a Resend:', error);
    return { ok: false, error: String(error) };
  }
}
