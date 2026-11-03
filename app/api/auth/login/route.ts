import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { createSessionValue, sessionCookieOptions } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login — entrada al panel del staff.
 *
 * El mensaje de error es el mismo tanto si el correo no existe como si la
 * contraseña no coincide: distinguirlos le diría a quien prueba al azar qué
 * correos están dados de alta.
 *
 * Tampoco se corta antes cuando el usuario no existe: se verifica igual
 * contra un hash de descarte para que el tiempo de respuesta no delate la
 * diferencia.
 */

const GENERIC_ERROR = 'Correo o contraseña incorrectos.';
/** Hash real de una contraseña aleatoria; solo sirve para gastar el mismo tiempo. */
const DUMMY_HASH = 'scrypt$16384$00000000000000000000000000000000$' + '0'.repeat(128);

export async function POST(request: Request): Promise<Response> {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'Faltan correo y contraseña.' }, { status: 400 });
  }

  // Si falta SESSION_SECRET, createSessionValue lanza. Se comprueba antes de
  // tocar la base para poder responder un JSON con un mensaje útil: sin esto
  // el endpoint devolvía 500 con cuerpo vacío y el panel solo mostraba
  // "Unexpected end of JSON input", que no dice nada a quien lo ve.
  if (!process.env['SESSION_SECRET'] || process.env['SESSION_SECRET'].length < 32) {
    return NextResponse.json(
      {
        ok: false,
        error: 'El servidor no tiene configurada la variable SESSION_SECRET (mínimo 32 caracteres).'
      },
      { status: 503 }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid || !user.active) {
    return NextResponse.json({ ok: false, error: GENERIC_ERROR }, { status: 401 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const session = createSessionValue({ userId: user.id, email: user.email, role: user.role });
  const response = NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
  response.cookies.set({ ...sessionCookieOptions(session.maxAge), value: session.value });
  return response;
}
