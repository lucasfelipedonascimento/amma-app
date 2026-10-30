import { describe, expect, it } from 'vitest';
import {
  decideProposal,
  isVotingOpen,
  requiredVotes,
  tally,
  validateVotingWindow,
  type VoteChoice,
} from './assembly';

const votes = (sim: number, nao: number, abs = 0): VoteChoice[] => [
  ...Array<VoteChoice>(sim).fill('SIM'),
  ...Array<VoteChoice>(nao).fill('NAO'),
  ...Array<VoteChoice>(abs).fill('ABSTENCAO'),
];

describe('tally', () => {
  it('conta cada tipo de voto', () => {
    expect(tally(votes(3, 2, 1))).toEqual({ yes: 3, no: 2, abstain: 1, total: 6 });
    expect(tally([])).toEqual({ yes: 0, no: 0, abstain: 0, total: 0 });
  });
});

describe('requiredVotes', () => {
  it('arredonda o quórum para cima e exige ao menos 1 voto', () => {
    expect(requiredVotes(10, 25)).toBe(3);
    expect(requiredVotes(10, 0)).toBe(1);
    expect(requiredVotes(0, 50)).toBe(1);
    expect(requiredVotes(7, 100)).toBe(7);
  });
  it('rejeita quórum fora de 0–100', () => {
    expect(() => requiredVotes(10, 101)).toThrow();
    expect(() => requiredVotes(10, -1)).toThrow();
    expect(() => requiredVotes(10, 12.5)).toThrow();
  });
});

describe('decideProposal', () => {
  it('mais SIM que NAO aprova', () => {
    expect(decideProposal(tally(votes(3, 2)), 10, 0)).toBe('APROVADA');
  });
  it('empate rejeita', () => {
    expect(decideProposal(tally(votes(2, 2)), 10, 0)).toBe('REJEITADA');
  });
  it('abstenção conta para o quórum, mas não para a maioria', () => {
    // 1 SIM, 0 NAO, 4 abstenções: quórum de 50% de 10 = 5 votos → vale; 1 > 0 aprova.
    expect(decideProposal(tally(votes(1, 0, 4)), 10, 50)).toBe('APROVADA');
    // só abstenções: quórum atingido, mas 0 > 0 é falso → rejeitada.
    expect(decideProposal(tally(votes(0, 0, 5)), 10, 50)).toBe('REJEITADA');
  });
  it('sem quórum não decide, mesmo com todos os votos a favor', () => {
    expect(decideProposal(tally(votes(2, 0)), 10, 50)).toBe('SEM_QUORUM');
  });
  it('ninguém votou: sem quórum', () => {
    expect(decideProposal(tally([]), 10, 0)).toBe('SEM_QUORUM');
  });
});

describe('isVotingOpen', () => {
  const closesAt = new Date('2026-11-01T12:00:00Z');
  it('aberta antes do prazo', () => {
    expect(isVotingOpen({ status: 'ABERTA', closesAt }, new Date('2026-11-01T11:59:59Z'))).toBe(
      true,
    );
  });
  it('fecha exatamente no prazo', () => {
    expect(isVotingOpen({ status: 'ABERTA', closesAt }, closesAt)).toBe(false);
  });
  it('proposta já encerrada nunca reabre', () => {
    expect(isVotingOpen({ status: 'APROVADA', closesAt }, new Date('2026-10-01T00:00:00Z'))).toBe(
      false,
    );
  });
});

describe('validateVotingWindow', () => {
  const open = new Date('2026-11-01T00:00:00Z');
  const plus = (h: number) => new Date(open.getTime() + h * 3_600_000);
  it('aceita de 24 horas a 60 dias', () => {
    expect(validateVotingWindow(open, plus(24))).toBeNull();
    expect(validateVotingWindow(open, plus(60 * 24))).toBeNull();
  });
  it('recusa prazo curto, longo ou invertido', () => {
    expect(validateVotingWindow(open, plus(23))).toMatch(/pelo menos/);
    expect(validateVotingWindow(open, plus(60 * 24 + 1))).toMatch(/até/);
    expect(validateVotingWindow(open, plus(-5))).toMatch(/pelo menos/);
    expect(validateVotingWindow(open, new Date('invalid'))).toMatch(/pelo menos/);
  });
});
