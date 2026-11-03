-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FlightStatus" AS ENUM ('SCHEDULED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "citySlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Hermosillo',
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiences" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flights" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 22,
    "seatsTaken" INTEGER NOT NULL DEFAULT 0,
    "status" "FlightStatus" NOT NULL DEFAULT 'SCHEDULED',
    "staffNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "holdExpiresAt" TIMESTAMP(3),
    "stripeSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "invoiceRequested" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL DEFAULT 'web',
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "passengerName" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedInBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seasons_citySlug_status_idx" ON "seasons"("citySlug", "status");

-- CreateIndex
CREATE UNIQUE INDEX "experiences_seasonId_slug_key" ON "experiences"("seasonId", "slug");

-- CreateIndex
CREATE INDEX "flights_startsAt_status_idx" ON "flights"("startsAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "flights_experienceId_startsAt_key" ON "flights"("experienceId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_stripeSessionId_key" ON "bookings"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_stripePaymentIntentId_key" ON "bookings"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "bookings_flightId_status_idx" ON "bookings"("flightId", "status");

-- CreateIndex
CREATE INDEX "bookings_customerEmail_idx" ON "bookings"("customerEmail");

-- CreateIndex
CREATE INDEX "bookings_status_holdExpiresAt_idx" ON "bookings"("status", "holdExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_qrToken_key" ON "tickets"("qrToken");

-- CreateIndex
CREATE INDEX "tickets_bookingId_idx" ON "tickets"("bookingId");

-- CreateIndex
CREATE INDEX "stripe_events_type_idx" ON "stripe_events"("type");

-- AddForeignKey
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "flights"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
