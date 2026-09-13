import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkWebhookSecret } from '@/lib/auth';
import { pickField } from '@/lib/field-matcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FULL_NAME_KEYS = ['Nombre completo', 'Nombre', 'Full name', 'Name'];
const EMAIL_KEYS = ['Correo electrónico', 'Correo', 'Email'];
const PHONE_KEYS = ['Teléfono', 'Telefono', 'Phone', 'WhatsApp'];
const GUEST_COUNT_KEYS = ['Invitados', 'Número de invitados', 'Guests'];
const ALL_MAPPED_KEYS = [...FULL_NAME_KEYS, ...EMAIL_KEYS, ...PHONE_KEYS, ...GUEST_COUNT_KEYS].map((key) =>
  key.toLowerCase()
);

/**
 * Recibe el `_webhook` de FormSubmit: `{ form_data: { ...cada campo con
 * name=, excepto los que empiezan con "_" } }`. No asumimos nombres de llave
 * exactos — form_data es una bolsa libre mapeada de forma defensiva con
 * pickField(). El payload completo siempre se guarda en `raw`, así que nada
 * se pierde aunque el mapeo falle para una sede nueva.
 */
export async function POST(request: Request): Promise<Response> {
  const authError = checkWebhookSecret(request);
  if (authError) {
    return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  }

  let body: { form_data?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const formData = body.form_data ?? {};
  const { searchParams } = new URL(request.url);
  const sede = searchParams.get('sede') || String(formData['Ciudad'] ?? 'desconocida');

  const fullName = pickField(formData, FULL_NAME_KEYS);
  const email = pickField(formData, EMAIL_KEYS);
  const phone = pickField(formData, PHONE_KEYS);
  const guestCount = pickField(formData, GUEST_COUNT_KEYS);

  const extraEntries = Object.entries(formData).filter(([key]) => !ALL_MAPPED_KEYS.includes(key.toLowerCase()));
  const extra = extraEntries.length ? Object.fromEntries(extraEntries) : undefined;

  await prisma.lead.create({
    data: {
      sede,
      source: 'formsubmit-webhook',
      fullName,
      email,
      phone,
      guestCount,
      extra: extra as Prisma.InputJsonValue | undefined,
      raw: formData as Prisma.InputJsonValue
    }
  });

  return NextResponse.json({ ok: true });
}
