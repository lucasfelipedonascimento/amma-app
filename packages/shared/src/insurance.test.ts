import { describe, expect, it } from 'vitest';
import { canMoveClaim, isClaimFinal, validateDecision } from './insurance';

describe('estados do pedido de seguro', () => {
  it('fluxo normal: enviada → em análise → decisão', () => {
    expect(canMoveClaim('ENVIADA', 'EM_ANALISE')).toBe(true);
    expect(canMoveClaim('EM_ANALISE', 'APROVADA')).toBe(true);
    expect(canMoveClaim('EM_ANALISE', 'NEGADA')).toBe(true);
  });
  it('não pula a análise: ninguém decide direto de ENVIADA', () => {
    expect(canMoveClaim('ENVIADA', 'APROVADA')).toBe(false);
    expect(canMoveClaim('ENVIADA', 'NEGADA')).toBe(false);
  });
  it('quem pediu pode cancelar até a decisão', () => {
    expect(canMoveClaim('ENVIADA', 'CANCELADA')).toBe(true);
    expect(canMoveClaim('EM_ANALISE', 'CANCELADA')).toBe(true);
  });
  it('decidido ou cancelado é final: nada sai de lá', () => {
    for (const s of ['APROVADA', 'NEGADA', 'CANCELADA'] as const) {
      expect(isClaimFinal(s)).toBe(true);
      for (const to of ['ENVIADA', 'EM_ANALISE', 'APROVADA', 'NEGADA', 'CANCELADA'] as const)
        expect(canMoveClaim(s, to)).toBe(false);
    }
    expect(isClaimFinal('ENVIADA')).toBe(false);
  });
});

describe('validateDecision', () => {
  const base = { note: 'Documentos conferidos e coerentes.', requestedCents: 100_000 };
  it('aprovar exige valor positivo até o pedido', () => {
    expect(validateDecision({ ...base, decision: 'APROVADA', approvedCents: 80_000 })).toBeNull();
    expect(validateDecision({ ...base, decision: 'APROVADA', approvedCents: 100_000 })).toBeNull();
    expect(validateDecision({ ...base, decision: 'APROVADA' })).toMatch(/valor aprovado/);
    expect(validateDecision({ ...base, decision: 'APROVADA', approvedCents: 0 })).toMatch(
      /valor aprovado/,
    );
    expect(validateDecision({ ...base, decision: 'APROVADA', approvedCents: 100_001 })).toMatch(
      /passar do valor pedido/,
    );
    expect(validateDecision({ ...base, decision: 'APROVADA', approvedCents: 10.5 })).toMatch(
      /valor aprovado/,
    );
  });
  it('negar exige motivo e não tem valor', () => {
    expect(validateDecision({ ...base, decision: 'NEGADA' })).toBeNull();
    expect(validateDecision({ ...base, decision: 'NEGADA', approvedCents: 1 })).toMatch(/negado/);
  });
  it('a decisão sempre exige explicação', () => {
    expect(validateDecision({ ...base, note: '   curto  ', decision: 'NEGADA' })).toMatch(/motivo/);
  });
});
