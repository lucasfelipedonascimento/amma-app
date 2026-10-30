-- CreateEnum
CREATE TYPE "BlockStatus" AS ENUM ('ATIVO', 'EM_RECURSO', 'MANTIDO', 'REVOGADO');

-- CreateEnum
CREATE TYPE "BudgetKind" AS ENUM ('RECEITA', 'DESPESA');

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMPTZ(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "blockedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "AccountBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "BlockStatus" NOT NULL DEFAULT 'ATIVO',
    "blockedById" TEXT NOT NULL,
    "blockedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appealText" TEXT,
    "appealedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionReason" TEXT,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,

    CONSTRAINT "AccountBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetEntry" (
    "id" TEXT NOT NULL,
    "kind" "BudgetKind" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredOn" DATE NOT NULL,
    "receiptRef" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversalOf" TEXT,

    CONSTRAINT "BudgetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountBlock_userId_status_idx" ON "AccountBlock"("userId", "status");

-- CreateIndex
CREATE INDEX "AccountBlock_status_blockedAt_idx" ON "AccountBlock"("status", "blockedAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetEntry_reversalOf_key" ON "BudgetEntry"("reversalOf");

-- CreateIndex
CREATE INDEX "BudgetEntry_occurredOn_idx" ON "BudgetEntry"("occurredOn");

-- AddForeignKey
ALTER TABLE "AccountBlock" ADD CONSTRAINT "AccountBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBlock" ADD CONSTRAINT "AccountBlock_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetEntry" ADD CONSTRAINT "BudgetEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cadastros de comerciante que já existiam foram aceitos antes de haver revisão: ficam APROVADO.
UPDATE "Merchant" SET "approvalStatus" = 'APROVADO' WHERE "reviewedAt" IS NULL;
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_rejection_reason"
  CHECK ("approvalStatus" <> 'REPROVADO' OR length(btrim(coalesce("rejectionReason", ''))) > 0);

-- Orçamento: valor positivo; um estorno só cancela lançamento existente.
ALTER TABLE "BudgetEntry" ADD CONSTRAINT "BudgetEntry_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "BudgetEntry" ADD CONSTRAINT "BudgetEntry_reversal_fk"
  FOREIGN KEY ("reversalOf") REFERENCES "BudgetEntry"("id");

-- Bloqueio: motivo obrigatório e só um em vigor por pessoa.
ALTER TABLE "AccountBlock" ADD CONSTRAINT "AccountBlock_reason_present" CHECK (length(btrim("reason")) > 0);
CREATE UNIQUE INDEX "AccountBlock_one_in_force" ON "AccountBlock" ("userId") WHERE "status" <> 'REVOGADO';

-- SOMENTE INSERÇÃO: trilha de auditoria e lançamentos do orçamento (função criada na migração da associação).
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION association_append_only();
CREATE TRIGGER "BudgetEntry_append_only" BEFORE UPDATE OR DELETE ON "BudgetEntry"
  FOR EACH ROW EXECUTE FUNCTION association_append_only();

-- Bloqueio: motivo, autor, pessoa e data não mudam; nada é apagado. Só andamento do recurso e revogação.
CREATE FUNCTION account_block_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bloqueios não são apagados' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."userId" <> OLD."userId" OR NEW."reason" <> OLD."reason"
     OR NEW."blockedById" <> OLD."blockedById" OR NEW."blockedAt" <> OLD."blockedAt" THEN
    RAISE EXCEPTION 'Motivo, autor e data do bloqueio não mudam' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AccountBlock_guard" BEFORE UPDATE OR DELETE ON "AccountBlock"
  FOR EACH ROW EXECUTE FUNCTION account_block_guard();
