import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { render, EJEMPLO } from '@/lib/email-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/email-templates/test — manda la plantilla a una dirección
 * concreta, con datos de ejemplo.
 *
 * Existe para poder ver el correo en una bandeja real (donde se nota lo que
 * la vista previa no muestra: cómo lo recorta Gmail, si las imágenes cargan,
 * si cae en spam) sin tener que generar una reserva de verdad.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ('error' in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  let body: { to?: unknown; subject?: unknown; bodyHtml?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const bodyHtml = typeof body.bodyHtml === 'string' ? body.bodyHtml : '';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ ok: false, error: 'Escribe un correo válido.' }, { status: 400 });
  }

  const apiKey = process.env['RESEND_API_KEY'];
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'Falta RESEND_API_KEY en el servidor: todavía no se pueden enviar correos.' },
      { status: 503 }
    );
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env['MAIL_FROM'] ?? 'Dinner in the Sky <reservas@dinnerinthesky.com.mx>',
      to: [to],
      // Marcado como prueba para que nadie lo confunda con una reserva real.
      subject: `[PRUEBA] ${render(subject, EJEMPLO)}`,
      html: render(bodyHtml, EJEMPLO)
    })
  });

  const payload = (await response.json()) as { id?: string; message?: string };

  if (!response.ok) {
    return NextResponse.json(
      { ok: false, error: payload.message ?? `Resend respondió ${response.status}.` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, id: payload.id });
}
