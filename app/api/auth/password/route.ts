import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/password';
import { currentSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/password — cambiar la propia contraseña.
 *
 * Las cuentas se crean con una contraseña aleatoria que imprime el script y
 * que viaja por WhatsApp o correo hasta la persona. Mientras no pueda
 * cambiarla, esa contraseña vive para siempre en una conversación. Esto es lo
 * que cierra ese hueco.
 *
 * Deliberadamente NO usa `requireStaff`: ese helper acepta también
 * ADMIN_API_KEY, que no identifica a nadie, y con una llave compartida
 * cualquiera podría cambiarle la contraseña a cualquiera. Aquí hace falta
 * saber exactamente quién es, así que solo vale la sesión.
 *
 * Tampoco acepta un `userId` en el body: cada quien cambia la suya. Un
 * administrador que necesite reponerle la contraseña a alguien más usa el
 * script de creación de usuarios, que deja rastro en la terminal de quien lo
 * corrió.
 */

const MINIMO = 10;

export async function POST(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Sesión no válida. Vuelve a entrar.' }, { status: 401 });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  const actual = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const nueva = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!actual || !nueva) {
    return NextResponse.json(
      { ok: false, error: 'Escribe tu contraseña actual y la nueva.' },
      { status: 400 }
    );
  }

  if (nueva.normalize('NFKC').length < MINIMO) {
    return NextResponse.json(
      { ok: false, error: `La contraseña nueva debe tener al menos ${MINIMO} caracteres.` },
      { status: 400 }
    );
  }

  if (nueva === actual) {
    return NextResponse.json(
      { ok: false, error: 'La contraseña nueva tiene que ser distinta de la actual.' },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) {
    return NextResponse.json({ ok: false, error: 'La cuenta ya no está activa.' }, { status: 401 });
  }

  // Pedir la contraseña actual importa aunque ya haya sesión: si alguien deja
  // el panel abierto en una tablet de la operación, no debería poder quedarse
  // con la cuenta.
  const valida = await verifyPassword(actual, user.passwordHash);
  if (!valida) {
    return NextResponse.json({ ok: false, error: 'Tu contraseña actual no coincide.' }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(nueva) }
  });

  // La sesión vigente sigue siendo válida: está firmada con el id del usuario
  // y no con la contraseña. Cerrar todas las sesiones al cambiarla es lo
  // correcto, pero hoy no hay dónde guardar qué sesiones existen, y fingir
  // que se cerraron sería peor que decirlo.
  return NextResponse.json({
    ok: true,
    aviso: 'Contraseña actualizada. Las sesiones abiertas en otros dispositivos siguen activas hasta que venzan.'
  });
}
