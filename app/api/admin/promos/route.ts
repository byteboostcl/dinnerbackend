import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/auth';
import { normalizeCode } from '@/lib/promo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIPOS = ['PERCENT', 'FIXED', 'FREE_SEATS', 'FULL_COMP'] as const;
type Tipo = (typeof TIPOS)[number];

/** GET — lista de códigos con su uso. */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ ok: true, promos });
}

/**
 * POST — crea un código.
 *
 * Las cortesías (FULL_COMP) exigen límite de canjes: un código que deja la
 * reserva en cero y se puede usar infinitas veces es una fuga de dinero
 * esperando a que alguien lo comparta. En TuriTop varios estaban así.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const code = normalizeCode(typeof body['code'] === 'string' ? body['code'] : '');
  const kind = String(body['kind'] ?? '').toUpperCase() as Tipo;
  const value = Number(body['value'] ?? 0);

  if (!code || !/^[A-Z0-9-]{3,}$/.test(code)) {
    return NextResponse.json(
      { ok: false, error: 'El código debe tener al menos 3 caracteres: letras, números o guiones.' },
      { status: 400 }
    );
  }
  if (!TIPOS.includes(kind)) {
    return NextResponse.json({ ok: false, error: `El tipo debe ser uno de: ${TIPOS.join(', ')}.` }, { status: 400 });
  }
  if (kind === 'PERCENT' && (!Number.isInteger(value) || value < 1 || value > 100)) {
    return NextResponse.json({ ok: false, error: 'El porcentaje debe ir de 1 a 100.' }, { status: 400 });
  }
  if ((kind === 'FIXED' || kind === 'FREE_SEATS') && (!Number.isInteger(value) || value < 1)) {
    return NextResponse.json({ ok: false, error: 'El valor debe ser un entero mayor que cero.' }, { status: 400 });
  }

  const maxRedemptions = Number.isInteger(body['maxRedemptions']) ? (body['maxRedemptions'] as number) : null;

  if (kind === 'FULL_COMP' && (maxRedemptions === null || maxRedemptions < 1)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Una cortesía necesita un límite de usos. Sin límite, quien conozca el código vuela gratis siempre.'
      },
      { status: 400 }
    );
  }

  const fecha = (valor: unknown): Date | null => {
    if (typeof valor !== 'string' || !valor.trim()) return null;
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  try {
    const promo = await prisma.promoCode.create({
      data: {
        code,
        description: typeof body['description'] === 'string' ? body['description'].trim() || null : null,
        kind,
        value: kind === 'FULL_COMP' ? 100 : value,
        buyRequired: Number.isInteger(body['buyRequired']) ? (body['buyRequired'] as number) : 1,
        maxRedemptions,
        minSeats: Number.isInteger(body['minSeats']) ? (body['minSeats'] as number) : 1,
        validFrom: fecha(body['validFrom']),
        validUntil: fecha(body['validUntil']),
        seasonId: typeof body['seasonId'] === 'string' && body['seasonId'] ? body['seasonId'] : null,
        experienceId: typeof body['experienceId'] === 'string' && body['experienceId'] ? body['experienceId'] : null,
        createdBy: auth.actor
      }
    });
    return NextResponse.json({ ok: true, promo }, { status: 201 });
  } catch (error) {
    if (String(error).includes('promo_codes_code_key')) {
      return NextResponse.json({ ok: false, error: `El código "${code}" ya existe.` }, { status: 409 });
    }
    throw error;
  }
}
