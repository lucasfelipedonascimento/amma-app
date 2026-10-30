-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('CRIADO', 'OFERECIDO', 'ACEITO', 'A_CAMINHO_COLETA', 'COLETADO', 'A_CAMINHO_ENTREGA', 'ENTREGUE', 'CANCELADO');

-- CreateEnum
CREATE TYPE "CancelReason" AS ENUM ('CLIENTE_DESISTIU', 'SEM_MOTORISTA', 'COLETA_IMPOSSIVEL', 'ENTREGA_IMPOSSIVEL', 'ADMIN_CANCELOU');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDENTE', 'ACEITA', 'RECUSADA', 'EXPIRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "DeliveryEventType" AS ENUM ('STATUS', 'OFERTA', 'ACEITE', 'RECUSA', 'EXPIRACAO', 'DESISTENCIA', 'SEM_CANDIDATOS');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('RIDE_SETTLEMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "associationRate" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DriverPresence" (
    "userId" TEXT NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "onlineSince" TIMESTAMPTZ(3),
    "location" geography(Point,4326),
    "locationAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverPresence_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'CRIADO',
    "clientId" TEXT NOT NULL,
    "workerId" TEXT,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "notes" TEXT,
    "distanceMeters" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "fareCents" INTEGER NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "minimumApplied" BOOLEAN NOT NULL,
    "platformFeeCents" INTEGER,
    "associationFeeCents" INTEGER,
    "workerNetCents" INTEGER,
    "associationRate" INTEGER,
    "cancelReason" "CancelReason",
    "cancelNote" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(3),
    "pickedUpAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOffer" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDENTE',
    "distanceMeters" INTEGER NOT NULL,
    "pickupEtaSeconds" INTEGER,
    "pickupRouteMeters" INTEGER,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "respondedAt" TIMESTAMPTZ(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "type" "DeliveryEventType" NOT NULL,
    "fromStatus" "DeliveryStatus",
    "toStatus" "DeliveryStatus",
    "actorId" TEXT,
    "reason" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "reference" TEXT NOT NULL,
    "reversalOf" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerPosting" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "LedgerPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingConfigVersion" (
    "version" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "baseCents" INTEGER NOT NULL,
    "perKmCents" INTEGER NOT NULL,
    "perMinuteCents" INTEGER NOT NULL,
    "minimumFareCents" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingConfigVersion_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "DispatchSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "radiusMeters" INTEGER NOT NULL,
    "offerTtlSeconds" INTEGER NOT NULL,
    "maxSearchSeconds" INTEGER NOT NULL,
    "maxPositionAgeSeconds" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DispatchSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverPresence_online_idx" ON "DriverPresence"("online");

-- CreateIndex
CREATE INDEX "Delivery_clientId_createdAt_idx" ON "Delivery"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Delivery_workerId_status_idx" ON "Delivery"("workerId", "status");

-- CreateIndex
CREATE INDEX "Delivery_status_idx" ON "Delivery"("status");

-- CreateIndex
CREATE INDEX "DeliveryOffer_deliveryId_status_idx" ON "DeliveryOffer"("deliveryId", "status");

-- CreateIndex
CREATE INDEX "DeliveryOffer_driverId_status_idx" ON "DeliveryOffer"("driverId", "status");

-- CreateIndex
CREATE INDEX "DeliveryOffer_status_expiresAt_idx" ON "DeliveryOffer"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "DeliveryEvent_deliveryId_createdAt_idx" ON "DeliveryEvent"("deliveryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reversalOf_key" ON "LedgerTransaction"("reversalOf");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_kind_reference_key" ON "LedgerTransaction"("kind", "reference");

-- CreateIndex
CREATE INDEX "LedgerPosting_account_idx" ON "LedgerPosting"("account");

-- CreateIndex
CREATE INDEX "LedgerPosting_transactionId_idx" ON "LedgerPosting"("transactionId");

-- CreateIndex
CREATE INDEX "PricingConfigVersion_effectiveFrom_idx" ON "PricingConfigVersion"("effectiveFrom");

-- AddForeignKey
ALTER TABLE "DriverPresence" ADD CONSTRAINT "DriverPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOffer" ADD CONSTRAINT "DeliveryOffer_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOffer" ADD CONSTRAINT "DeliveryOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Busca por proximidade (ST_DWithin / distância) usa este índice espacial.
CREATE INDEX "DriverPresence_location_gist" ON "DriverPresence" USING GIST ("location");

-- Ledger SOMENTE INSERÇÃO: nenhuma linha pode ser alterada ou apagada. Correção = estorno (nova transação).
-- Só sobra TRUNCATE (usado para limpar o banco de TESTES; nunca é executado pela aplicação).
CREATE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'O ledger é somente inserção (% em %)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER "LedgerPosting_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerPosting"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- Lançamentos sempre com valor positivo; a direção diz se é débito ou crédito.
ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_amount_positive" CHECK ("amountCents" > 0);
