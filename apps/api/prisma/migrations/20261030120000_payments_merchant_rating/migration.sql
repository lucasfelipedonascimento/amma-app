-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CARTAO');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDENTE', 'PAGO', 'EXPIRADO', 'ESTORNADO');

-- AlterEnum
ALTER TYPE "CancelReason" ADD VALUE 'PAGAMENTO_NAO_CONFIRMADO';

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDENTE',
    "amountCents" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "pixCode" TEXT,
    "pixExpiresAt" TIMESTAMPTZ(3),
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "refundedAt" TIMESTAMPTZ(3),
    "refundRef" TEXT,
    "refundReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "userId" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "cnpj" TEXT,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_deliveryId_key" ON "Payment"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "Payment"("providerRef");

-- CreateIndex
CREATE INDEX "Payment_status_pixExpiresAt_idx" ON "Payment"("status", "pixExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_cnpj_key" ON "Merchant"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_deliveryId_key" ON "Rating"("deliveryId");

-- CreateIndex
CREATE INDEX "Rating_driverId_idx" ON "Rating"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_clientId_idempotencyKey_key" ON "Delivery"("clientId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- O banco também confere o que o código já valida.
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_stars_range" CHECK ("stars" BETWEEN 1 AND 5);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountCents" > 0);
