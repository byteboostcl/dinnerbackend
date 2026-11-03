/**
 * Alta de un usuario del panel.
 *
 *   node scripts/create-user.mjs joan@dinnerinthesky.com.mx "Joan" STAFF
 *
 * La contraseña no se pasa por argumento a propósito: quedaría en el
 * historial del shell y en la lista de procesos. Se genera una aleatoria y se
 * imprime una sola vez; quien la reciba debe cambiarla al entrar.
 *
 * Si el correo ya existe, actualiza nombre y rol y regenera la contraseña
 * (sirve también para recuperar un acceso perdido).
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const prisma = new PrismaClient();

async function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = await scrypt(plain.normalize('NFKC'), salt, 64, { N: 16384 });
  return `scrypt$16384$${salt.toString('hex')}$${derived.toString('hex')}`;
}

const [, , emailArg, nameArg, roleArg = 'STAFF'] = process.argv;

if (!emailArg || !nameArg) {
  console.error('Uso: node scripts/create-user.mjs <correo> "<nombre>" [ADMIN|STAFF]');
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const role = roleArg.toUpperCase();

if (!['ADMIN', 'STAFF'].includes(role)) {
  console.error(`Rol inválido: ${role}. Usa ADMIN o STAFF.`);
  process.exit(1);
}

// 18 bytes en base64url ≈ 24 caracteres: suficiente para que no se adivine y
// todavía copiable a mano.
const password = randomBytes(18).toString('base64url');
const passwordHash = await hashPassword(password);

const user = await prisma.user.upsert({
  where: { email },
  update: { name: nameArg, role, passwordHash, active: true },
  create: { email, name: nameArg, role, passwordHash }
});

console.log('\nUsuario listo:');
console.log('  correo:     ', user.email);
console.log('  nombre:     ', user.name);
console.log('  rol:        ', user.role);
console.log('  contraseña: ', password);
console.log('\nEsta contraseña no se vuelve a mostrar. Mándala por un canal privado');
console.log('y pide que se cambie al primer ingreso.\n');

await prisma.$disconnect();
