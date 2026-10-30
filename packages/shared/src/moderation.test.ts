import { describe, expect, it } from 'vitest';
import {
  APPEAL_WINDOW_DAYS,
  appealDeadline,
  canAppeal,
  canBlockUser,
  canDecideAppeal,
  isBlockInForce,
  statusAfterAppeal,
  validateReason,
} from './moderation';

const T0 = new Date('2026-10-01T12:00:00Z');
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

describe('canAppeal', () => {
  it('bloqueio ativo dentro do prazo', () =>
    expect(canAppeal({ status: 'ATIVO', blockedAt: T0 }, days(5))).toEqual({ ok: true }));
  it('no último instante do prazo ainda vale', () =>
    expect(canAppeal({ status: 'ATIVO', blockedAt: T0 }, days(APPEAL_WINDOW_DAYS)).ok).toBe(true));
  it('depois do prazo não', () =>
    expect(canAppeal({ status: 'ATIVO', blockedAt: T0 }, days(APPEAL_WINDOW_DAYS + 1)).ok).toBe(
      false,
    ));
  it('só um recurso por bloqueio', () => {
    expect(canAppeal({ status: 'EM_RECURSO', blockedAt: T0 }, days(1)).ok).toBe(false);
    expect(canAppeal({ status: 'MANTIDO', blockedAt: T0 }, days(1)).ok).toBe(false);
    expect(canAppeal({ status: 'REVOGADO', blockedAt: T0 }, days(1)).ok).toBe(false);
  });
});

describe('decisão e bloqueio', () => {
  it('recurso aceito revoga, negado mantém', () => {
    expect(statusAfterAppeal('ACEITO')).toBe('REVOGADO');
    expect(statusAfterAppeal('NEGADO')).toBe('MANTIDO');
  });
  it('só revogado libera a conta', () => {
    expect(isBlockInForce('REVOGADO')).toBe(false);
    for (const s of ['ATIVO', 'EM_RECURSO', 'MANTIDO'] as const)
      expect(isBlockInForce(s)).toBe(true);
  });
  it('quem bloqueou não decide o recurso', () => {
    expect(canDecideAppeal('a', 'a')).toBe(false);
    expect(canDecideAppeal('a', 'b')).toBe(true);
  });
  it('não bloqueia a si mesmo nem outro admin', () => {
    expect(canBlockUser({ id: 'a', roles: ['MOTORISTA'] }, 'a')).toBe(false);
    expect(canBlockUser({ id: 'b', roles: ['ADMIN'] }, 'a')).toBe(false);
    expect(canBlockUser({ id: 'b', roles: ['MOTORISTA'] }, 'a')).toBe(true);
  });
  it('prazo', () => expect(appealDeadline(T0).toISOString()).toBe(days(30).toISOString()));
});

describe('validateReason', () => {
  it('limites', () => {
    expect(validateReason('curto', 10, 100)).toMatch(/pelo menos 10/);
    expect(validateReason('   ', 10, 100)).not.toBeNull();
    expect(validateReason('x'.repeat(101), 10, 100)).toMatch(/No máximo/);
    expect(validateReason('motivo suficiente', 10, 100)).toBeNull();
  });
});
