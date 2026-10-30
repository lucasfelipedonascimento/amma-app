-- CreateEnum
CREATE TYPE "DeliveryKind" AS ENUM ('ENTREGA', 'CORRIDA');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMININO', 'MASCULINO', 'NAO_INFORMADO');

-- CreateEnum
CREATE TYPE "RatingDirection" AS ENUM ('CLIENTE_AVALIA_MOTORISTA', 'MOTORISTA_AVALIA_CLIENTE');

-- CreateEnum
CREATE TYPE "ReportCategory" AS ENUM ('ASSEDIO', 'VIOLENCIA', 'DISCRIMINACAO', 'DIRECAO_PERIGOSA', 'MOTORISTA_DIFERENTE', 'VEICULO_DIFERENTE', 'COBRANCA_INDEVIDA', 'OUTRO');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('ABERTA', 'EM_ANALISE', 'PROCEDENTE', 'IMPROCEDENTE', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "EmergencyStatus" AS ENUM ('ABERTO', 'EM_ATENDIMENTO', 'ENCERRADO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'ANTECEDENTES';
ALTER TYPE "DocumentType" ADD VALUE 'LICENCA_MUNICIPAL';
ALTER TYPE "DocumentType" ADD VALUE 'SEGURO_PASSAGEIROS';

-- Avaliação passa a ser mútua: "driverId" vira "rateeId" (quem recebeu a nota). Renomear preserva os dados.
ALTER TABLE "Rating" RENAME COLUMN "driverId" TO "rateeId";
ALTER TABLE "Rating" RENAME CONSTRAINT "Rating_driverId_fkey" TO "Rating_rateeId_fkey";
ALTER INDEX "Rating_driverId_idx" RENAME TO "Rating_rateeId_idx";

-- DropIndex
DROP INDEX "PricingConfigVersion_effectiveFrom_idx";

-- DropIndex
DROP INDEX "Rating_deliveryId_key";

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "boardingPin" TEXT,
ADD COLUMN     "boardingPinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "DeliveryKind" NOT NULL DEFAULT 'ENTREGA',
ADD COLUMN     "vehicleId" TEXT,
ADD COLUMN     "vehicleType" "VehicleType",
ADD COLUMN     "womenDriverOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "gender" "Gender",
ADD COLUMN     "genderVerifiedAt" TIMESTAMPTZ(3),
ADD COLUMN     "genderVerifiedById" TEXT;

-- AlterTable
ALTER TABLE "PricingConfigVersion" ADD COLUMN     "profile" TEXT NOT NULL DEFAULT 'ENTREGA';

-- AlterTable
ALTER TABLE "Rating" ADD COLUMN     "direction" "RatingDirection" NOT NULL DEFAULT 'CLIENTE_AVALIA_MOTORISTA';

-- CreateTable
CREATE TABLE "TripShare" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "contactLabel" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TripShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "actorRole" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "note" TEXT,
    "status" "EmergencyStatus" NOT NULL DEFAULT 'ABERTO',
    "handledById" TEXT,
    "handledNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmergencyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT,
    "deliveryId" TEXT,
    "category" "ReportCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'ABERTA',
    "handledById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripPoint" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripRecordAccess" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripRecordAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MunicipalRulesVersion" (
    "version" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "rules" JSONB NOT NULL,
    "legalReference" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MunicipalRulesVersion_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripShare_tokenHash_key" ON "TripShare"("tokenHash");

-- CreateIndex
CREATE INDEX "TripShare_deliveryId_idx" ON "TripShare"("deliveryId");

-- CreateIndex
CREATE INDEX "EmergencyAlert_status_createdAt_idx" ON "EmergencyAlert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmergencyAlert_deliveryId_idx" ON "EmergencyAlert"("deliveryId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_deliveryId_idx" ON "Report"("deliveryId");

-- CreateIndex
CREATE INDEX "Report_reportedId_idx" ON "Report"("reportedId");

-- CreateIndex
CREATE INDEX "TripPoint_deliveryId_at_idx" ON "TripPoint"("deliveryId", "at");

-- CreateIndex
CREATE INDEX "TripPoint_at_idx" ON "TripPoint"("at");

-- CreateIndex
CREATE INDEX "TripRecordAccess_deliveryId_idx" ON "TripRecordAccess"("deliveryId");

-- CreateIndex
CREATE INDEX "MunicipalRulesVersion_effectiveFrom_idx" ON "MunicipalRulesVersion"("effectiveFrom");

-- CreateIndex
CREATE INDEX "Delivery_kind_clientId_createdAt_idx" ON "Delivery"("kind", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "PricingConfigVersion_profile_effectiveFrom_idx" ON "PricingConfigVersion"("profile", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_deliveryId_direction_key" ON "Rating"("deliveryId", "direction");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripShare" ADD CONSTRAINT "TripShare_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPoint" ADD CONSTRAINT "TripPoint_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Alerta de emergência mantém a posição e a nota só enquanto fizerem sentido; valores de coordenada válidos.
ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_lat_range" CHECK ("lat" IS NULL OR "lat" BETWEEN -90 AND 90);
ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_lng_range" CHECK ("lng" IS NULL OR "lng" BETWEEN -180 AND 180);
-- PIN de embarque: sempre 4 dígitos quando existe.
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_boardingPin_format" CHECK ("boardingPin" IS NULL OR "boardingPin" ~ '^[0-9]{4}$');
-- Corrida sempre tem tipo de veículo e PIN; entrega nunca tem.
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_kind_fields" CHECK (
  ("kind" = 'CORRIDA' AND "vehicleType" IS NOT NULL AND "boardingPin" IS NOT NULL)
  OR ("kind" = 'ENTREGA' AND "boardingPin" IS NULL AND "womenDriverOnly" = false)
);
