-- AlterTable: motivo y autor de la cancelación, y notas internas del equipo.
-- Todas nullable: ninguna reserva existente necesita rellenarse.
ALTER TABLE "bookings" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "bookings" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "bookings" ADD COLUMN "internalNotes" TEXT;

-- CreateTable: registro de correos enviados.
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bookingId" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "sentBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_logs_bookingId_idx" ON "email_logs"("bookingId");

-- CreateIndex
CREATE INDEX "email_logs_kind_createdAt_idx" ON "email_logs"("kind", "createdAt");

-- AddForeignKey: SetNull para que borrar una reserva no borre su historial.
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
