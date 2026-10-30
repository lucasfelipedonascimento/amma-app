-- CreateEnum
CREATE TYPE "PointType" AS ENUM ('ESPACO_PUBLICO', 'CASA_PARCEIRA', 'COMERCIO');

-- CreateEnum
CREATE TYPE "PointStatus" AS ENUM ('EM_ANALISE', 'ATIVO', 'SUSPENSO', 'RECUSADO', 'REMOVIDO');

-- CreateEnum
CREATE TYPE "Amenity" AS ENUM ('AGUA', 'BANHEIRO', 'CARREGADOR', 'DESCANSO', 'WIFI', 'ALIMENTACAO', 'ESTACIONAMENTO');

-- CreateEnum
CREATE TYPE "HostBenefitKind" AS ENUM ('CREDITO', 'DESCONTO');

-- CreateEnum
CREATE TYPE "PointRatingDirection" AS ENUM ('VISITANTE_AVALIA_PONTO', 'ANFITRIAO_AVALIA_VISITANTE');

-- CreateEnum
CREATE TYPE "PointReportCategory" AS ENUM ('SEGURANCA', 'ASSEDIO', 'COBRANCA_INDEVIDA', 'LOCAL_INEXISTENTE', 'ESTRUTURA_DIFERENTE', 'OUTRO');

-- CreateEnum
CREATE TYPE "PointReportStatus" AS ENUM ('ABERTA', 'PROCEDENTE', 'IMPROCEDENTE');

-- AlterEnum
ALTER TYPE "LedgerKind" ADD VALUE 'HOST_BENEFIT';

-- CreateTable
CREATE TABLE "WelcomePoint" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "PointType" NOT NULL,
    "status" "PointStatus" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "reference" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "hours" JSONB NOT NULL,
    "amenities" "Amenity"[],
    "capacity" INTEGER NOT NULL,
    "benefitKind" "HostBenefitKind" NOT NULL DEFAULT 'CREDITO',
    "checklist" JSONB,
    "statusNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WelcomePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WelcomePointPhoto" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WelcomePointPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "distanceMeters" INTEGER NOT NULL,
    "benefitCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointRating" (
    "id" TEXT NOT NULL,
    "checkInId" TEXT NOT NULL,
    "direction" "PointRatingDirection" NOT NULL,
    "authorId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointReport" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "category" "PointReportCategory" NOT NULL,
    "text" TEXT,
    "status" "PointReportStatus" NOT NULL DEFAULT 'ABERTA',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "response" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointEvent" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" "PointStatus",
    "toStatus" "PointStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WelcomePoint_status_lat_lng_idx" ON "WelcomePoint"("status", "lat", "lng");

-- CreateIndex
CREATE INDEX "WelcomePoint_ownerId_idx" ON "WelcomePoint"("ownerId");

-- CreateIndex
CREATE INDEX "WelcomePointPhoto_pointId_idx" ON "WelcomePointPhoto"("pointId");

-- CreateIndex
CREATE INDEX "CheckIn_pointId_startedAt_idx" ON "CheckIn"("pointId", "startedAt");

-- CreateIndex
CREATE INDEX "CheckIn_userId_startedAt_idx" ON "CheckIn"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "PointRating_authorId_idx" ON "PointRating"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "PointRating_checkInId_direction_key" ON "PointRating"("checkInId", "direction");

-- CreateIndex
CREATE INDEX "PointReport_pointId_status_idx" ON "PointReport"("pointId", "status");

-- CreateIndex
CREATE INDEX "PointReport_status_createdAt_idx" ON "PointReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PointEvent_pointId_createdAt_idx" ON "PointEvent"("pointId", "createdAt");

-- AddForeignKey
ALTER TABLE "WelcomePoint" ADD CONSTRAINT "WelcomePoint_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomePointPhoto" ADD CONSTRAINT "WelcomePointPhoto_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "WelcomePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "WelcomePoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRating" ADD CONSTRAINT "PointRating_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRating" ADD CONSTRAINT "PointRating_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointReport" ADD CONSTRAINT "PointReport_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "WelcomePoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointReport" ADD CONSTRAINT "PointReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointEvent" ADD CONSTRAINT "PointEvent_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "WelcomePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Regras que o banco garante sozinho, mesmo que a API erre.
ALTER TABLE "PointRating" ADD CONSTRAINT "PointRating_stars_check" CHECK ("stars" BETWEEN 1 AND 5);
ALTER TABLE "WelcomePoint" ADD CONSTRAINT "WelcomePoint_capacity_check" CHECK ("capacity" BETWEEN 1 AND 50);
ALTER TABLE "WelcomePoint" ADD CONSTRAINT "WelcomePoint_coords_check"
  CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_benefit_check" CHECK ("benefitCents" >= 0);

-- Uma denúncia aberta por pessoa em cada ponto (repetir não conta como mais denunciantes).
CREATE UNIQUE INDEX "PointReport_one_open_per_reporter" ON "PointReport" ("pointId", "reporterId")
  WHERE "status" = 'ABERTA';

-- Um check-in aberto por pessoa por vez.
CREATE UNIQUE INDEX "CheckIn_one_open_per_user" ON "CheckIn" ("userId") WHERE "endedAt" IS NULL;

-- Linha do tempo do ponto: só inserção (a função vem da migração da associação).
CREATE TRIGGER "PointEvent_append_only" BEFORE UPDATE OR DELETE ON "PointEvent"
  FOR EACH ROW EXECUTE FUNCTION association_append_only();
