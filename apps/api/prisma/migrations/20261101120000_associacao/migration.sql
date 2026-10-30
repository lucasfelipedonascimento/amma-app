-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('GERAL', 'REGRA_COMPRA_COLETIVA');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('ABERTA', 'APROVADA', 'REJEITADA', 'SEM_QUORUM');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('SIM', 'NAO', 'ABSTENCAO');

-- CreateEnum
CREATE TYPE "VoteAction" AS ENUM ('VOTOU', 'MUDOU');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('ABERTO', 'ENCERRADO');

-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('NA_FILA', 'CONTEMPLADO', 'DESISTIU');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('CONFIRMADO', 'RECUSADO');

-- CreateEnum
CREATE TYPE "ClaimKind" AS ENUM ('ACIDENTE', 'ROUBO_FURTO', 'DANOS_VEICULO', 'OUTRO');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('ENVIADA', 'EM_ANALISE', 'APROVADA', 'NEGADA', 'CANCELADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerKind" ADD VALUE 'GROUP_CONTRIBUTION';
ALTER TYPE "LedgerKind" ADD VALUE 'SURPLUS_DISTRIBUTION';

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ruleChange" JSONB,
    "quorumPercent" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL,
    "opensAt" TIMESTAMPTZ(3) NOT NULL,
    "closesAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'ABERTA',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "yesCount" INTEGER,
    "noCount" INTEGER,
    "abstainCount" INTEGER,
    "ballotDigest" TEXT,
    "appliedRulesVersion" TEXT,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "castAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteRecord" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "action" "VoteAction" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRulesVersion" (
    "id" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "proposalId" TEXT,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRulesVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "vehicleType" "VehicleType" NOT NULL,
    "targetCents" INTEGER NOT NULL,
    "status" "GroupStatus" NOT NULL DEFAULT 'ABERTO',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "QueueEntryStatus" NOT NULL DEFAULT 'NA_FILA',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "ContributionStatus" NOT NULL,
    "partner" TEXT NOT NULL,
    "partnerRef" TEXT,
    "declineReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupAward" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "fundedCents" INTEGER NOT NULL,
    "awardedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaim" (
    "id" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "kind" "ClaimKind" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT NOT NULL,
    "requestedCents" INTEGER NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'ENVIADA',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "approvedCents" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceAttachment" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceEvent" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "ClaimStatus",
    "toStatus" "ClaimStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurplusRun" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "distributableCents" INTEGER NOT NULL,
    "useWeightPercent" INTEGER NOT NULL,
    "totalUseCents" INTEGER NOT NULL,
    "totalQuotas" INTEGER NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurplusRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurplusShare" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quotas" INTEGER NOT NULL,
    "useCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "SurplusShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Proposal_status_closesAt_idx" ON "Proposal"("status", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_proposalId_voterId_key" ON "Vote"("proposalId", "voterId");

-- CreateIndex
CREATE INDEX "VoteRecord_proposalId_createdAt_idx" ON "VoteRecord"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "VoteRecord_voterId_idx" ON "VoteRecord"("voterId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRulesVersion_proposalId_key" ON "PurchaseRulesVersion"("proposalId");

-- CreateIndex
CREATE INDEX "PurchaseRulesVersion_effectiveFrom_idx" ON "PurchaseRulesVersion"("effectiveFrom");

-- CreateIndex
CREATE INDEX "QueueEntry_groupId_status_idx" ON "QueueEntry"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_groupId_userId_key" ON "QueueEntry"("groupId", "userId");

-- CreateIndex
CREATE INDEX "Contribution_groupId_status_idx" ON "Contribution"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_userId_idempotencyKey_key" ON "Contribution"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAward_entryId_key" ON "GroupAward"("entryId");

-- CreateIndex
CREATE INDEX "GroupAward_groupId_idx" ON "GroupAward"("groupId");

-- CreateIndex
CREATE INDEX "InsuranceClaim_claimantId_createdAt_idx" ON "InsuranceClaim"("claimantId", "createdAt");

-- CreateIndex
CREATE INDEX "InsuranceClaim_status_createdAt_idx" ON "InsuranceClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InsuranceAttachment_claimId_idx" ON "InsuranceAttachment"("claimId");

-- CreateIndex
CREATE INDEX "InsuranceEvent_claimId_createdAt_idx" ON "InsuranceEvent"("claimId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurplusRun_year_key" ON "SurplusRun"("year");

-- CreateIndex
CREATE INDEX "SurplusShare_userId_idx" ON "SurplusShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SurplusShare_runId_userId_key" ON "SurplusShare"("runId", "userId");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRecord" ADD CONSTRAINT "VoteRecord_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRecord" ADD CONSTRAINT "VoteRecord_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PurchaseGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PurchaseGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAward" ADD CONSTRAINT "GroupAward_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PurchaseGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAward" ADD CONSTRAINT "GroupAward_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "QueueEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceAttachment" ADD CONSTRAINT "InsuranceAttachment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InsuranceClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceEvent" ADD CONSTRAINT "InsuranceEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InsuranceClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurplusShare" ADD CONSTRAINT "SurplusShare_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SurplusRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurplusShare" ADD CONSTRAINT "SurplusShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garantias no banco (além das checagens da API)
-- ---------------------------------------------------------------------------

-- Valores em centavos sempre positivos.
ALTER TABLE "PurchaseGroup" ADD CONSTRAINT "PurchaseGroup_target_positive" CHECK ("targetCents" > 0);
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_requested_positive" CHECK ("requestedCents" > 0);
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_approved_within_request"
  CHECK ("approvedCents" IS NULL OR ("approvedCents" > 0 AND "approvedCents" <= "requestedCents"));
ALTER TABLE "SurplusShare" ADD CONSTRAINT "SurplusShare_amount_nonnegative" CHECK ("amountCents" >= 0);
ALTER TABLE "SurplusRun" ADD CONSTRAINT "SurplusRun_distributable_positive" CHECK ("distributableCents" > 0);
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_quorum_range" CHECK ("quorumPercent" BETWEEN 0 AND 100);
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_window" CHECK ("closesAt" > "opensAt");

-- SOMENTE INSERÇÃO: histórico de votos, regras, contemplações, linha do tempo do seguro e sobras.
-- Corrigir = registrar um novo fato; nada é editado nem apagado.
CREATE FUNCTION association_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registro somente inserção (% em %)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VoteRecord_append_only" BEFORE UPDATE OR DELETE ON "VoteRecord"
  FOR EACH ROW EXECUTE FUNCTION association_append_only();
CREATE TRIGGER "PurchaseRulesVersion_append_only" BEFORE UPDATE OR DELETE ON "PurchaseRulesVersion"
  FOR EACH ROW EXECUTE FUNCTION association_append_only();
CREATE TRIGGER "GroupAward_append_only" BEFORE UPDATE OR DELETE ON "GroupAward"
  FOR EACH ROW EXECUTE FUNCTION association_append_only();
CREATE TRIGGER "InsuranceEvent_append_only" BEFORE UPDATE OR DELETE ON "InsuranceEvent"
  FOR EACH ROW EXECUTE FUNCTION association_append_only();
CREATE TRIGGER "SurplusRun_append_only" BEFORE UPDATE OR DELETE ON "SurplusRun"
  FOR EACH ROW EXECUTE FUNCTION association_append_only();
CREATE TRIGGER "SurplusShare_append_only" BEFORE UPDATE OR DELETE ON "SurplusShare"
  FOR EACH ROW EXECUTE FUNCTION association_append_only();

-- Proposta: nunca apagada; depois de fechada (status != ABERTA) nada muda.
-- Aberta, só o fechamento pode escrevê-la (título, texto, prazo e regra proposta não mudam).
CREATE FUNCTION proposal_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Proposta não pode ser apagada' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'ABERTA' THEN
    RAISE EXCEPTION 'Proposta encerrada não pode ser alterada' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind <> OLD.kind OR NEW.title <> OLD.title OR NEW.description <> OLD.description
     OR NEW."ruleChange" IS DISTINCT FROM OLD."ruleChange" OR NEW."quorumPercent" <> OLD."quorumPercent"
     OR NEW."eligibleCount" <> OLD."eligibleCount" OR NEW."opensAt" <> OLD."opensAt"
     OR NEW."closesAt" <> OLD."closesAt" OR NEW."createdById" <> OLD."createdById" THEN
    RAISE EXCEPTION 'Proposta aberta só muda no fechamento' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Proposal_guard" BEFORE UPDATE OR DELETE ON "Proposal"
  FOR EACH ROW EXECUTE FUNCTION proposal_guard();

-- Voto: só enquanto a proposta está ABERTA e no prazo; nunca apagado. A API também confere.
CREATE FUNCTION vote_guard() RETURNS trigger AS $$
DECLARE
  p RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Voto não pode ser apagado (mude o voto em vez disso)' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT status, "closesAt" INTO p FROM "Proposal" WHERE id = NEW."proposalId";
  IF p.status <> 'ABERTA' THEN
    RAISE EXCEPTION 'A votação desta proposta já foi encerrada' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."voterId" <> OLD."voterId" OR NEW."proposalId" <> OLD."proposalId") THEN
    RAISE EXCEPTION 'Voto não pode trocar de dono' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Vote_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Vote"
  FOR EACH ROW EXECUTE FUNCTION vote_guard();
