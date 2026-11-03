import { NextResponse } from 'next/server';
import { sessionCookieOptions } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — borra la cookie de sesión. */
export async function POST(): Promise<Response> {
  const response = NextResponse.json({ ok: true });
  // maxAge 0 la expira de inmediato en el navegador.
  response.cookies.set({ ...sessionCookieOptions(0), value: '' });
  return response;
}
