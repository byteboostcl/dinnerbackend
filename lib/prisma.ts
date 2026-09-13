import { PrismaClient } from '@prisma/client';

// Next.js recarga módulos en dev; sin este singleton en globalThis se abre una
// conexión nueva a Postgres en cada hot-reload hasta agotar el pool. En
// producción (Railway corre `next start` como proceso Node persistente, no
// serverless) un único PrismaClient para todo el proceso es lo correcto.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
