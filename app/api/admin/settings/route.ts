import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Configuración de la empresa, para el panel del staff. Es una fila única
 * (id "default"): el GET la crea con valores iniciales si aún no existe para
 * que el panel nunca tenga que manejar el caso "sin configuración".
 */

const DEFAULT_ID = 'default';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GTM_ID = /^GTM-[A-Z0-9]{4,}$/;
const GA4_ID = /^G-[A-Z0-9]{4,}$/;
const PIXEL_ID = /^\d{8,20}$/;

/** Campos de texto libre opcionales: se guardan null si llegan vacíos. */
const OPTIONAL_TEXT_FIELDS = [
  'bookingsEmail',
  'phone',
  'website',
  'facebook',
  'instagram',
  'tiktok',
  'gtmId',
  'metaPixelId',
  'ga4Id',
  'confirmationUrl',
  'cancellationPolicy',
  'termsUrl',
  'privacyUrl'
] as const;

const URL_FIELDS = ['website', 'facebook', 'instagram', 'tiktok', 'confirmationUrl', 'termsUrl', 'privacyUrl'] as const;

type OptionalField = (typeof OPTIONAL_TEXT_FIELDS)[number];

function esUrlHttp(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function zonaValida(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** GET: devuelve la configuración, creándola con valores iniciales si falta. */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const settings = await prisma.companySettings.upsert({
    where: { id: DEFAULT_ID },
    update: {},
    create: {
      id: DEFAULT_ID,
      companyName: 'Dinner in the Sky México',
      contactEmail: 'reservas@dinnerinthesky.com.mx'
    }
  });

  return NextResponse.json({ ok: true, settings });
}

/** PUT: guarda la configuración completa que envía el formulario. */
export async function PUT(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'El cuerpo debe ser JSON válido.' }, { status: 400 });
  }

  const texto = (key: string): string => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
  const fail = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });

  const companyName = texto('companyName');
  const contactEmail = texto('contactEmail');
  const timezone = texto('timezone');
  const currency = texto('currency').toUpperCase();

  if (!companyName) return fail('El nombre de la empresa es obligatorio.');
  if (!EMAIL.test(contactEmail)) return fail('El correo de contacto no tiene un formato válido.');
  if (!timezone || !zonaValida(timezone)) return fail('La zona horaria no es válida.');
  if (!/^[A-Z]{3}$/.test(currency)) return fail('La moneda debe ser un código de 3 letras, por ejemplo MXN.');

  const optional = {} as Record<OptionalField, string | null>;
  for (const field of OPTIONAL_TEXT_FIELDS) {
    optional[field] = texto(field) || null;
  }

  if (optional.bookingsEmail && !EMAIL.test(optional.bookingsEmail)) {
    return fail('El correo de reservaciones no tiene un formato válido.');
  }
  for (const field of URL_FIELDS) {
    const value = optional[field];
    if (value && !esUrlHttp(value)) return fail(`El campo ${field} debe ser una URL que empiece con http:// o https://.`);
  }
  if (optional.gtmId && !GTM_ID.test(optional.gtmId)) return fail('El ID de Google Tag Manager debe tener el formato GTM-XXXX.');
  if (optional.ga4Id && !GA4_ID.test(optional.ga4Id)) return fail('El ID de Google Analytics 4 debe tener el formato G-XXXXXXXX.');
  if (optional.metaPixelId && !PIXEL_ID.test(optional.metaPixelId)) {
    return fail('El ID del Pixel de Meta debe ser numérico (8 a 20 dígitos).');
  }

  const data = { companyName, contactEmail, timezone, currency, ...optional, updatedBy: auth.actor };

  const settings = await prisma.companySettings.upsert({
    where: { id: DEFAULT_ID },
    update: data,
    create: { id: DEFAULT_ID, ...data }
  });

  return NextResponse.json({ ok: true, settings });
}
