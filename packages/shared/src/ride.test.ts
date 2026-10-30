import { describe, expect, it } from 'vitest';
import {
  BOARDING_PIN_LENGTH,
  boardingPinVisible,
  canShareRide,
  firstName,
  generateBoardingPin,
  isValidBoardingPin,
  pricingProfile,
  shareIsOpen,
  SHARE_GRACE_MINUTES,
  statusLabel,
} from './ride';
import { DELIVERY_STATUSES } from './delivery-state';

describe('corrida de passageiro', () => {
  it('perfil de preço: entrega ignora o veículo; corrida separa carro e moto', () => {
    expect(pricingProfile('ENTREGA', 'MOTO')).toBe('ENTREGA');
    expect(pricingProfile('ENTREGA')).toBe('ENTREGA');
    expect(pricingProfile('CORRIDA', 'MOTO')).toBe('CORRIDA_MOTO');
    expect(pricingProfile('CORRIDA', 'CARRO')).toBe('CORRIDA_CARRO');
  });

  it('todo estado tem texto nos dois tipos, e a corrida fala de embarque', () => {
    for (const s of DELIVERY_STATUSES) {
      expect(statusLabel('ENTREGA', s)).toBeTruthy();
      expect(statusLabel('CORRIDA', s)).toBeTruthy();
    }
    expect(statusLabel('CORRIDA', 'COLETADO')).toBe('Você embarcou');
    expect(statusLabel('ENTREGA', 'COLETADO')).toBe('Item coletado');
  });

  describe('PIN de embarque', () => {
    it('tem sempre 4 dígitos, inclusive com zeros à esquerda', () => {
      expect(generateBoardingPin(() => 7)).toBe('0007');
      expect(generateBoardingPin(() => 9999)).toBe('9999');
      expect(generateBoardingPin(() => 0)).toHaveLength(BOARDING_PIN_LENGTH);
    });
    it('valida formato', () => {
      expect(isValidBoardingPin('0123')).toBe(true);
      for (const bad of ['123', '12345', 'abcd', '12 4', 1234, null, undefined])
        expect(isValidBoardingPin(bad)).toBe(false);
    });
    it('só aparece até o embarque', () => {
      expect(boardingPinVisible('ACEITO')).toBe(true);
      expect(boardingPinVisible('A_CAMINHO_COLETA')).toBe(true);
      expect(boardingPinVisible('CRIADO')).toBe(true);
      for (const s of ['COLETADO', 'A_CAMINHO_ENTREGA', 'ENTREGUE', 'CANCELADO'] as const)
        expect(boardingPinVisible(s)).toBe(false);
    });
  });

  describe('compartilhar a viagem', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    it('só com motorista definido e corrida em andamento', () => {
      expect(canShareRide('ACEITO')).toBe(true);
      expect(canShareRide('A_CAMINHO_ENTREGA')).toBe(true);
      for (const s of ['CRIADO', 'OFERECIDO', 'ENTREGUE', 'CANCELADO'] as const)
        expect(canShareRide(s)).toBe(false);
    });
    it('link aberto durante a corrida e por 30 min depois; revogado nunca', () => {
      expect(shareIsOpen({ revoked: false, status: 'COLETADO', endedAt: null }, now)).toBe(true);
      const ended = new Date(now.getTime() - SHARE_GRACE_MINUTES * 60_000);
      expect(shareIsOpen({ revoked: false, status: 'ENTREGUE', endedAt: ended }, now)).toBe(true);
      expect(
        shareIsOpen(
          { revoked: false, status: 'ENTREGUE', endedAt: new Date(ended.getTime() - 1) },
          now,
        ),
      ).toBe(false);
      expect(shareIsOpen({ revoked: true, status: 'COLETADO', endedAt: null }, now)).toBe(false);
    });
  });

  it('primeiro nome', () => {
    expect(firstName('  Maria da Silva ')).toBe('Maria');
    expect(firstName('')).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});
