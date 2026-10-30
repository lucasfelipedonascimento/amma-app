import type { AssociationRate, Level } from '@amma/shared';

export interface AssociationMe {
  associationRate: AssociationRate;
  rateOptions: AssociationRate[];
  quotaValueCents: number;
  quotas: number;
  remainderCents: number;
  isMember: boolean;
  minQuotasToBeMember: number;
  progress: {
    level: Level;
    nextLevel: Level | null;
    quotasToNext: number | null;
    centsToNext: number | null;
    percent: number;
  };
  history: { at: string; kind: string; cents: number }[];
}

export interface SurplusItem {
  year: number;
  amountCents: number;
  quotas: number;
  useCents: number;
  useWeightPercent: number;
  closedAt: string;
}

export type VoteChoice = 'SIM' | 'NAO' | 'ABSTENCAO';
export type ProposalStatus = 'ABERTA' | 'APROVADA' | 'REJEITADA' | 'SEM_QUORUM';

export interface Proposal {
  id: string;
  kind: 'GERAL' | 'REGRA_COMPRA_COLETIVA';
  title: string;
  description: string;
  ruleChange: Record<string, number> | null;
  status: ProposalStatus;
  opensAt: string;
  closesAt: string;
  quorumPercent: number;
  eligibleCount: number;
  requiredVotes: number;
  myVote: VoteChoice | null;
  result: {
    yes: number;
    no: number;
    abstain: number;
    total: number;
    closedAt: string;
    appliedRulesVersion: string | null;
  } | null;
}

export interface PurchaseGroupItem {
  id: string;
  name: string;
  description: string | null;
  vehicleType: 'MOTO' | 'CARRO';
  targetCents: number;
  status: 'ABERTO' | 'ENCERRADO';
  fundedCents: number;
  queueSize: number;
  myStatus: 'NA_FILA' | 'CONTEMPLADO' | 'DESISTIU' | null;
}

export interface PurchaseGroupDetail extends Omit<PurchaseGroupItem, 'queueSize'> {
  availableUnits: number;
  rules: {
    quotaWeight: number;
    dayWeight: number;
    minQuotas: number;
    minContributionCents: number;
  };
  queue: {
    position: number;
    name: string;
    quotas: number;
    score: number;
    daysInQueue: number;
    isMe: boolean;
  }[];
  awards: { position: number; name: string; awardedAt: string; isMe: boolean }[];
}

export interface Contribution {
  id: string;
  amountCents: number;
  status: 'CONFIRMADO' | 'RECUSADO';
  declineReason: string | null;
  partner: string;
  createdAt: string;
}

export type ClaimKind = 'ACIDENTE' | 'ROUBO_FURTO' | 'DANOS_VEICULO' | 'OUTRO';
export type ClaimStatus = 'ENVIADA' | 'EM_ANALISE' | 'APROVADA' | 'NEGADA' | 'CANCELADA';

export interface Claim {
  id: string;
  kind: ClaimKind;
  status: ClaimStatus;
  occurredAt: string;
  description: string;
  requestedCents: number;
  approvedCents: number | null;
  decisionNote: string | null;
  createdAt: string;
  attachments: { id: string; mimeType: string; sizeBytes: number }[];
  timeline: { from: ClaimStatus | null; to: ClaimStatus; note: string | null; at: string }[];
}
