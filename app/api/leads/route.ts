import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkApiKey } from '@/lib/auth';
import { buildCorsHeaders } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lista los leads guardados. Protegido con header x-api-key o ?api_key=. Filtra opcionalmente por ?sede=. */
export async function GET(request: Request): Promise<Response> {
  const authError = checkApiKey(request);
  if (authError) {
    return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sede = searchParams.get('sede') ?? undefined;

  const leads = await prisma.lead.findMany({
    where: sede ? { sede } : {},
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json(leads);
}

type SubmitBody = {
  sede?: unknown;
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  guestCount?: unknown;
  /** Honeypot: input oculto en el form que un humano nunca llena. Si viene con
   * algo, es un bot — respondemos ok igual (para no delatar el honeypot) pero
   * no guardamos nada. */
  website?: unknown;
  [key: string]: unknown;
};

/**
 * Endpoint público para que el sitio (Angular) registre un lead directo,
 * sin pasar por formsubmit.co. Pensado para sedes como Hermosillo donde
 * formsubmit.co resultó poco confiable (rate limit fuera de nuestro control).
 * Sin captcha: la única defensa anti-bot es el honeypot `website`. Si esto
 * empieza a recibir spam real, lo siguiente es sumar un captcha o un
 * rate-limit por IP.
 */
export async function POST(request: Request): Promise<Response> {
  const cors = buildCorsHeaders(request.headers.get('origin'));

  let body: SubmitBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400, headers: cors });
  }

  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return NextResponse.json({ ok: true }, { headers: cors });
  }

  const sede = typeof body.sede === 'string' ? body.sede.trim() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : null;
  const guestCount = typeof body.guestCount === 'string' ? body.guestCount.trim() : null;

  if (!sede || !fullName || !email) {
    return NextResponse.json(
      { ok: false, error: 'Faltan campos obligatorios: sede, fullName y email.' },
      { status: 400, headers: cors }
    );
  }

  const { website: _website, sede: _sede, fullName: _fullName, email: _email, phone: _phone, guestCount: _guestCount, ...rest } = body;
  const extra = Object.keys(rest).length ? rest : undefined;

  await prisma.lead.create({
    data: {
      sede,
      source: 'website-direct',
      fullName,
      email,
      phone,
      guestCount,
      extra: extra as Prisma.InputJsonValue | undefined,
      raw: body as Prisma.InputJsonValue
    }
  });

  return NextResponse.json({ ok: true }, { headers: cors });
}

/** Preflight CORS para el POST de arriba — el navegador lo dispara solo porque mandamos JSON. */
export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request.headers.get('origin')) });
}
