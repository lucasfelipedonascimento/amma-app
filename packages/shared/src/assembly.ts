/**
 * Assembleia: 1 sócio = 1 voto. O voto pode ser mudado até o fechamento; depois disso o resultado
 * e o histórico não mudam mais. Regras puras; a persistência está na API.
 */
export const VOTE_CHOICES = ['SIM', 'NAO', 'ABSTENCAO'] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

export const PROPOSAL_KINDS = ['GERAL', 'REGRA_COMPRA_COLETIVA'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ['ABERTA', 'APROVADA', 'REJEITADA', 'SEM_QUORUM'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Prazo mínimo e máximo de votação, para todo sócio ter tempo de votar. */
export const MIN_VOTING_HOURS = 24;
export const MAX_VOTING_DAYS = 60;

export interface Tally {
  yes: number;
  no: number;
  abstain: number;
  total: number;
}

export function tally(choices: readonly VoteChoice[]): Tally {
  const t = { yes: 0, no: 0, abstain: 0, total: choices.length };
  for (const c of choices) {
    if (c === 'SIM') t.yes++;
    else if (c === 'NAO') t.no++;
    else t.abstain++;
  }
  return t;
}

/** Votos mínimos para valer: quorumPercent dos sócios aptos (arredonda para cima), nunca menos de 1. */
export function requiredVotes(eligibleCount: number, quorumPercent: number): number {
  if (!Number.isInteger(quorumPercent) || quorumPercent < 0 || quorumPercent > 100)
    throw new Error('Quórum deve ser inteiro de 0 a 100');
  return Math.max(1, Math.ceil((eligibleCount * quorumPercent) / 100));
}

/**
 * Resultado no fechamento. Abstenção conta para o quórum, mas não para a maioria.
 * Aprovada só com mais SIM que NAO; empate é rejeitada.
 */
export function decideProposal(
  t: Tally,
  eligibleCount: number,
  quorumPercent: number,
): Exclude<ProposalStatus, 'ABERTA'> {
  if (t.total < requiredVotes(eligibleCount, quorumPercent)) return 'SEM_QUORUM';
  return t.yes > t.no ? 'APROVADA' : 'REJEITADA';
}

/** Votação aberta enquanto a proposta está ABERTA e o prazo não chegou (no prazo exato já fechou). */
export function isVotingOpen(
  p: { status: ProposalStatus; closesAt: Date | string },
  now: Date,
): boolean {
  return p.status === 'ABERTA' && now.getTime() < new Date(p.closesAt).getTime();
}

/** Confere o prazo de uma proposta nova. Devolve a mensagem do erro, ou null se estiver ok. */
export function validateVotingWindow(opensAt: Date, closesAt: Date): string | null {
  const hours = (closesAt.getTime() - opensAt.getTime()) / 3_600_000;
  if (!Number.isFinite(hours) || hours < MIN_VOTING_HOURS)
    return `O prazo de votação deve ser de pelo menos ${MIN_VOTING_HOURS} horas`;
  if (hours > MAX_VOTING_DAYS * 24)
    return `O prazo de votação deve ser de até ${MAX_VOTING_DAYS} dias`;
  return null;
}
