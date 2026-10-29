import { describe, expect, it } from 'vitest';
import { evaluateRefresh } from './refresh';

const now = new Date('2026-10-29T12:00:00Z');
describe('evaluateRefresh', () => {
  it('válido', () =>
    expect(evaluateRefresh({ expiresAt: new Date(now.getTime() + 1), revokedAt: null }, now)).toBe(
      'OK',
    ));
  it('expirado', () =>
    expect(evaluateRefresh({ expiresAt: now, revokedAt: null }, now)).toBe('EXPIRED'));
  it('já usado/revogado = reuso (revoga tudo)', () =>
    expect(
      evaluateRefresh({ expiresAt: new Date(now.getTime() + 1000), revokedAt: now }, now),
    ).toBe('REUSED'));
});
