import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// promisify pierde la sobrecarga que admite opciones, y sin opciones no se
// puede fijar el coste. Se re-declara el tipo con la firma que sí se usa.
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

/**
 * Hash de contraseñas con scrypt, que viene en Node y no necesita instalar
 * nada. Se eligió sobre bcrypt o argon2 por eso mismo: una dependencia nativa
 * menos que compilar en el despliegue, y scrypt es un algoritmo adecuado para
 * contraseñas (lento y costoso en memoria a propósito, para que probar
 * millones por segundo no salga gratis).
 *
 * Formato guardado: `scrypt$N$sal$hash`, todo en hexadecimal. Llevar el
 * parámetro de coste dentro del propio valor permite subirlo en el futuro sin
 * invalidar las contraseñas ya guardadas.
 */

const KEY_LENGTH = 64;
const COST = 16384; // 2^14

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(plain.normalize('NFKC'), salt, KEY_LENGTH, { N: COST })) as Buffer;
  return `scrypt$${COST}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Comparación en tiempo constante: comparar con === filtra información por el
 * tiempo que tarda en fallar.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') {
    return false;
  }

  const cost = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');

  if (!Number.isInteger(cost) || salt.length === 0 || expected.length === 0) {
    return false;
  }

  const derived = (await scrypt(plain.normalize('NFKC'), salt, expected.length, { N: cost })) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
