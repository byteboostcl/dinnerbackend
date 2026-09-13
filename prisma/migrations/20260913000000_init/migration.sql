-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "sede" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'formsubmit-webhook',
    "fullName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "guestCount" TEXT,
    "extra" JSONB,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_sede_idx" ON "leads"("sede");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");
