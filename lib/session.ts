import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * Sesión del panel: una cookie firmada, sin dependencias.
 *
 * Por qué cookie y no un token en localStorage (que es lo que hace el admin
 * de Hacienda Montero): una cookie `httpOnly` no la puede leer el JavaScript
 * de la página, así que un script inyectado no puede robar la sesión. En
 * localStorage sí. Como el panel y la API viven en el mismo dominio, aquí no
 * hay razón para renunciar a eso.
 *
 * El contenido va firmado con HMAC usando SESSION_SECRET: el navegador puede
 * leer su cookie, pero no fabricar una válida ni cambiarse el rol.
 */

const COOKIE_NAME = 'dits_session';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 h: una jornada, sin dejarla abierta para siempre.

export interface SessionPayload {
  userId: string;
  email: string;
  role: string;
  /** Vencimiento en segundos desde época. */
  exp: number;
}

function secret(): string {
  const value = process.env['SESSION_SECRET'];
  if (!value || value.length < 32) {
    // Falla cerrado: sin secreto robusto no se emiten ni aceptan sesiones.
    throw new Error('SESSION_SECRET no está configurado o es demasiado corto (mínimo 32 caracteres).');
  }
  return value;
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function createSessionValue(payload: Omit<SessionPayload, 'exp'>): { value: string; maxAge: number } {
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  return { value: `${body}.${sign(body)}`, maxAge: MAX_AGE_SECONDS };
}

export function readSessionValue(raw: string | undefined): SessionPayload | null {
  if (!raw) {
    return null;
  }

  const [body, signature] = raw.split('.');
  if (!body || !signature) {
    return null;
  }

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Sesión del request actual, o null. Para usar dentro de route handlers. */
export async function currentSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return readSessionValue(store.get(COOKIE_NAME)?.value);
}

export const SESSION_COOKIE = COOKIE_NAME;

export function sessionCookieOptions(maxAge: number) {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge
  };
}

/** Identificador para trazar acciones del staff en los registros. */
export function newRequestId(): string {
  return randomUUID();
}
