import type { Level } from '@amma/shared';
import type { ClaimKind, ClaimStatus, ProposalStatus, VoteChoice } from './types';

export const LEVEL_LABEL: Record<Level, string> = {
  BRONZE: 'Bronze',
  SILVER: 'Prata',
  GOLD: 'Ouro',
};

export const VOTE_LABEL: Record<VoteChoice, string> = {
  SIM: 'Sim',
  NAO: 'Não',
  ABSTENCAO: 'Abstenção',
};

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  ABERTA: 'Votação aberta',
  APROVADA: 'Aprovada',
  REJEITADA: 'Rejeitada',
  SEM_QUORUM: 'Sem quórum',
};

export const CLAIM_KIND_LABEL: Record<ClaimKind, string> = {
  ACIDENTE: 'Acidente',
  ROUBO_FURTO: 'Roubo ou furto',
  DANOS_VEICULO: 'Danos ao veículo',
  OUTRO: 'Outro',
};

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  ENVIADA: 'Enviado',
  EM_ANALISE: 'Em análise',
  APROVADA: 'Aprovado',
  NEGADA: 'Negado',
  CANCELADA: 'Cancelado',
};

const RULE_LABEL: Record<string, string> = {
  quotaWeight: 'Pontos por cota',
  dayWeight: 'Pontos por dia de fila',
  minQuotas: 'Mínimo de cotas para entrar',
  minContributionCents: 'Aporte mínimo (centavos)',
};

export const ruleLabel = (key: string) => RULE_LABEL[key] ?? key;
