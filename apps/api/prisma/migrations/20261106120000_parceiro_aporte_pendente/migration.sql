-- AlterEnum
ALTER TYPE "ContributionStatus" ADD VALUE 'PENDENTE';

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN "instructions" TEXT,
ADD COLUMN "confirmedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "PartnerWebhookEvent" (
    "id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWebhookEvent_partner_eventId_key" ON "PartnerWebhookEvent"("partner", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_partner_partnerRef_key" ON "Contribution"("partner", "partnerRef");

-- CreateIndex
CREATE INDEX "Contribution_status_createdAt_idx" ON "Contribution"("status", "createdAt");
