import type { Cents } from './money';

/**
 * Seguro mútuo. A decisão é SEMPRE de uma pessoa da associação (nunca automática) e quem pede
 * não decide o próprio pedido. Máquina de estados pura; a persistência está na API.
 */
export const CLAIM_KINDS = ['ACIDENTE', 'ROUBO_FURTO', 'DANOS_VEICULO', 'OUTRO'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_STATUSES = ['ENVIADA', 'EM_ANALISE', 'APROVADA', 'NEGADA', 'CANCELADA'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  ENVIADA: ['EM_ANALISE', 'CANCELADA'],
  EM_ANALISE: ['APROVADA', 'NEGADA', 'CANCELADA'],
  APROVADA: [],
  NEGADA: [],
  CANCELADA: [],
};

export const canMoveClaim = (from: ClaimStatus, to: ClaimStatus): boolean =>
  TRANSITIONS[from].includes(to);

/** Decidido ou cancelado: não aceita mais anexos nem mudanças. */
export const isClaimFinal = (s: ClaimStatus): boolean => TRANSITIONS[s].length === 0;

export const MAX_CLAIM_ATTACHMENTS = 8;

/** Mínimo de caracteres na descrição do pedido e no motivo da decisão. */
export const MIN_CLAIM_TEXT = 10;

export interface ClaimDecisionInput {
  decision: 'APROVADA' | 'NEGADA';
  note: string;
  requestedCents: Cents;
  approvedCents?: Cents;
}

/** Confere a decisão humana. Devolve a mensagem do erro, ou null. Aprovar exige valor ≤ pedido; negar exige motivo. */
export function validateDecision(d: ClaimDecisionInput): string | null {
  if (d.note.trim().length < MIN_CLAIM_TEXT)
    return `Explique o motivo da decisão (mínimo ${MIN_CLAIM_TEXT} caracteres)`;
  if (d.decision === 'NEGADA')
    return d.approvedCents === undefined ? null : 'Pedido negado não tem valor aprovado';
  if (d.approvedCents === undefined || !Number.isInteger(d.approvedCents) || d.approvedCents <= 0)
    return 'Informe o valor aprovado em centavos';
  if (d.approvedCents > d.requestedCents) return 'O valor aprovado não pode passar do valor pedido';
  return null;
}
