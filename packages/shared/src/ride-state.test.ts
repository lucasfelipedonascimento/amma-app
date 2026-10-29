import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal, transition, type RideStatus } from './ride-state';

describe('ride state machine', () => {
  it('percorre o fluxo feliz', () => {
    let s: RideStatus = 'REQUESTED';
    for (const next of ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'] as const)
      s = transition(s, next);
    expect(s).toBe('COMPLETED');
  });
  it('permite cancelar até ARRIVED, mas não depois de iniciada', () => {
    expect(canTransition('REQUESTED', 'CANCELLED')).toBe(true);
    expect(canTransition('ACCEPTED', 'CANCELLED')).toBe(true);
    expect(canTransition('ARRIVED', 'CANCELLED')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'CANCELLED')).toBe(false);
  });
  it('só expira a partir de REQUESTED', () => {
    expect(canTransition('REQUESTED', 'EXPIRED')).toBe(true);
    expect(canTransition('ACCEPTED', 'EXPIRED')).toBe(false);
  });
  it('bloqueia pular etapas e sair de estado final', () => {
    expect(() => transition('REQUESTED', 'IN_PROGRESS')).toThrow();
    expect(() => transition('COMPLETED', 'CANCELLED')).toThrow();
    expect(isTerminal('COMPLETED') && isTerminal('CANCELLED') && isTerminal('EXPIRED')).toBe(true);
    expect(isTerminal('ACCEPTED')).toBe(false);
  });
});
