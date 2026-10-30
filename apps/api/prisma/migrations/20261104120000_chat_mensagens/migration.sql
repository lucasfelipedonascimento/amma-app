-- CreateTable
CREATE TABLE "DeliveryMessage" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryMessage_deliveryId_createdAt_idx" ON "DeliveryMessage"("deliveryId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryMessage_senderId_idx" ON "DeliveryMessage"("senderId");

-- AddForeignKey
ALTER TABLE "DeliveryMessage" ADD CONSTRAINT "DeliveryMessage_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryMessage" ADD CONSTRAINT "DeliveryMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
