-- CreateEnum
CREATE TYPE "CitySiteStatus" AS ENUM ('LIVE', 'PENDING');

-- CreateTable
CREATE TABLE "cities" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "siteStatus" "CitySiteStatus" NOT NULL DEFAULT 'PENDING',
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("slug")
);

-- Alta de las sedes que el sitio ya tiene hoy, con el slug exacto de su ruta.
-- LIVE son las que tienen página propia en el Angular (ensenada, puebla,
-- hermosillo, ciudad-de-mexico). Tijuana queda PENDING porque su tarjeta
-- enlaza fuera del sitio y no tiene ruta interna.
INSERT INTO "cities" ("slug", "name", "timezone", "siteStatus", "position", "updatedAt") VALUES
  ('ciudad-de-mexico', 'Ciudad de México', 'America/Mexico_City', 'LIVE',    1, now()),
  ('hermosillo',       'Hermosillo',       'America/Hermosillo',  'LIVE',    2, now()),
  ('puebla',           'Puebla',           'America/Mexico_City', 'LIVE',    3, now()),
  ('ensenada',         'Ensenada',         'America/Tijuana',     'LIVE',    4, now()),
  ('tijuana',          'Tijuana',          'America/Tijuana',     'PENDING', 5, now())
ON CONFLICT ("slug") DO NOTHING;
