/**
 * Marca una ciudad como visible en el sitio.
 *
 *   node scripts/city-live.mjs hermosillo
 *   node scripts/city-live.mjs hermosillo --pending     (lo deshace)
 *
 * Esto NO publica nada por sí solo. Se corre DESPUÉS de haber construido la
 * página de la ciudad en el repositorio Angular y haberla desplegado: su ruta
 * en app.routes.ts, su alta en CITIES dentro de site-data.ts, sus textos y sus
 * fotos. El flag solo le dice al panel la verdad sobre lo que el sitio ya
 * muestra, para que el equipo no publique una temporada creyendo que se ve y
 * se quede esperando reservas que nunca van a llegar.
 *
 * Es un script y no un botón del panel a propósito: quien lo corre es quien
 * desplegó la página, que es la única persona que sabe si ya existe.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const [slug, ...flags] = process.argv.slice(2);
const pending = flags.includes('--pending');

if (!slug) {
  console.error('Uso: node scripts/city-live.mjs <slug> [--pending]');
  process.exit(1);
}

const city = await prisma.city.findUnique({ where: { slug } });

if (!city) {
  const todas = await prisma.city.findMany({ orderBy: { position: 'asc' } });
  console.error(`No existe la ciudad "${slug}".`);
  console.error('Las que hay: ' + todas.map(c => c.slug).join(', '));
  await prisma.$disconnect();
  process.exit(1);
}

const siteStatus = pending ? 'PENDING' : 'LIVE';

if (city.siteStatus === siteStatus) {
  console.log(`"${city.name}" ya estaba en ${siteStatus}. Nada que hacer.`);
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.city.update({ where: { slug }, data: { siteStatus } });

console.log(`"${city.name}" (${slug}): ${city.siteStatus} → ${siteStatus}`);

if (siteStatus === 'LIVE') {
  console.log('');
  console.log('Comprueba que en el repositorio Angular ya estén, o el panel dirá una mentira:');
  console.log(`  · la ruta '${slug}' en src/app/app.routes.ts`);
  console.log(`  · la ciudad en CITIES, en src/app/data/site-data.ts`);
  console.log(`  · '${slug}' en CIUDADES_RESERVA_PROPIA, si se vende con el sistema propio`);
}

await prisma.$disconnect();
