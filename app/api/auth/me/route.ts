import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/me — quién está en sesión. El panel lo usa al cargar. */
export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ ok: false, user: null }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    user: { id: session.userId, email: session.email, role: session.role }
  });
}
