-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('CONCLUIDA', 'INDISPONIVEL');

-- CreateTable
CREATE TABLE "DocumentVerification" (
    "documentId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "recommendation" TEXT,
    "findings" JSONB NOT NULL,
    "extracted" JSONB NOT NULL,
    "engine" TEXT,
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DocumentVerification_pkey" PRIMARY KEY ("documentId")
);

-- AddForeignKey
ALTER TABLE "DocumentVerification" ADD CONSTRAINT "DocumentVerification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
