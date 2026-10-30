import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MUNICIPAL_RULES,
  evaluateRideEligibility,
  isVerifiedWoman,
  validateMunicipalRules,
  vehicleAgeYears,
  yearsBetween,
  type MunicipalRules,
} from './municipal-rules';
import type { DocumentInfo } from './driver-approval';

const now = new Date('2026-10-30T12:00:00Z');
const doc = (
  type: DocumentInfo['type'],
  status: DocumentInfo['status'] = 'APROVADO',
  at = '2026-01-01T00:00:00Z',
): DocumentInfo => ({
  type,
  status,
  createdAt: at,
});
const base = [doc('CNH'), doc('DOCUMENTO_VEICULO'), doc('FOTO')];
const rules = (
  patch: Partial<MunicipalRules['car']> = {},
  moto: Partial<MunicipalRules['moto']> = {},
): MunicipalRules => ({
  ...DEFAULT_MUNICIPAL_RULES,
  car: { ...DEFAULT_MUNICIPAL_RULES.car, ...patch },
  moto: { ...DEFAULT_MUNICIPAL_RULES.moto, enabled: true, ...moto },
});
const input = (over: Partial<Parameters<typeof evaluateRideEligibility>[1]> = {}) => ({
  vehicle: { type: 'CARRO' as const, year: 2022 },
  documents: base,
  birthDate: '1990-05-20',
  ...over,
});

describe('regras municipais', () => {
  it('o padrão é válido, libera carro e mantém o mototáxi desligado até a associação confirmar', () => {
    expect(validateMunicipalRules(DEFAULT_MUNICIPAL_RULES)).toEqual([]);
    expect(DEFAULT_MUNICIPAL_RULES.car.enabled).toBe(true);
    expect(DEFAULT_MUNICIPAL_RULES.moto.enabled).toBe(false);
  });

  describe('validação', () => {
    it('recusa idade fora do limite, documento desconhecido e sem os 3 básicos', () => {
      const bad = rules({ maxVehicleAgeYears: -1, minDriverAgeYears: 15 });
      expect(validateMunicipalRules(bad)).toHaveLength(2);
      expect(
        validateMunicipalRules(rules({ requiredDocuments: ['CNH', 'XYZ' as never] })),
      ).toHaveLength(1);
      expect(validateMunicipalRules(rules({ requiredDocuments: ['CNH'] }))[0]).toMatch(
        /deve incluir/,
      );
      expect(validateMunicipalRules(rules({ maxVehicleAgeYears: 5.5 }))).toHaveLength(1);
    });
    it('aceita documentos extras', () => {
      expect(
        validateMunicipalRules(
          rules({ requiredDocuments: ['CNH', 'DOCUMENTO_VEICULO', 'FOTO', 'LICENCA_MUNICIPAL'] }),
        ),
      ).toEqual([]);
    });
  });

  it('idade do veículo e do motorista', () => {
    expect(vehicleAgeYears(2016, now)).toBe(10);
    expect(yearsBetween('1990-12-31', now)).toBe(35); // ainda não fez aniversário em 2026
    expect(yearsBetween('1990-10-30', now)).toBe(36); // faz hoje
    expect(yearsBetween('1990-10-31', now)).toBe(35);
  });

  describe('elegibilidade', () => {
    it('carro dentro das regras', () => {
      expect(evaluateRideEligibility(rules(), input(), now)).toEqual({
        eligible: true,
        problems: [],
        documentsToSend: [],
      });
    });
    it('idade máxima é inclusiva', () => {
      const r = rules({ maxVehicleAgeYears: 10 });
      expect(
        evaluateRideEligibility(r, input({ vehicle: { type: 'CARRO', year: 2016 } }), now).eligible,
      ).toBe(true);
      expect(
        evaluateRideEligibility(r, input({ vehicle: { type: 'CARRO', year: 2015 } }), now).problems,
      ).toEqual(['VEICULO_MUITO_VELHO']);
    });
    it('mototáxi desligado: ninguém é elegível, mesmo com tudo certo', () => {
      const r = DEFAULT_MUNICIPAL_RULES;
      expect(
        evaluateRideEligibility(r, input({ vehicle: { type: 'MOTO', year: 2024 } }), now).problems,
      ).toEqual(['CATEGORIA_DESLIGADA']);
    });
    it('mototáxi ligado usa as regras da moto, não as do carro', () => {
      const r = rules({}, { maxVehicleAgeYears: 3 });
      expect(
        evaluateRideEligibility(r, input({ vehicle: { type: 'MOTO', year: 2022 } }), now).problems,
      ).toEqual(['VEICULO_MUITO_VELHO']);
      expect(
        evaluateRideEligibility(r, input({ vehicle: { type: 'MOTO', year: 2024 } }), now).eligible,
      ).toBe(true);
    });
    it('motorista abaixo da idade mínima', () => {
      expect(
        evaluateRideEligibility(
          rules({ minDriverAgeYears: 25 }),
          input({ birthDate: '2005-01-01' }),
          now,
        ).problems,
      ).toEqual(['MOTORISTA_MUITO_NOVO']);
    });
    it('documento extra exigido: faltando, em análise e reprovado', () => {
      const r = rules({
        requiredDocuments: ['CNH', 'DOCUMENTO_VEICULO', 'FOTO', 'LICENCA_MUNICIPAL'],
      });
      expect(evaluateRideEligibility(r, input(), now)).toMatchObject({
        eligible: false,
        problems: ['DOCUMENTO_FALTANDO'],
        documentsToSend: ['LICENCA_MUNICIPAL'],
      });
      expect(
        evaluateRideEligibility(
          r,
          input({ documents: [...base, doc('LICENCA_MUNICIPAL', 'PENDENTE')] }),
          now,
        ),
      ).toMatchObject({ problems: ['DOCUMENTO_PENDENTE'], documentsToSend: [] });
      expect(
        evaluateRideEligibility(
          r,
          input({ documents: [...base, doc('LICENCA_MUNICIPAL', 'REPROVADO')] }),
          now,
        ),
      ).toMatchObject({
        problems: ['DOCUMENTO_REPROVADO'],
        documentsToSend: ['LICENCA_MUNICIPAL'],
      });
    });
    it('vale o último envio de cada tipo', () => {
      const docs = [
        doc('CNH', 'REPROVADO', '2026-01-01T00:00:00Z'),
        doc('CNH', 'APROVADO', '2026-02-01T00:00:00Z'),
        doc('DOCUMENTO_VEICULO'),
        doc('FOTO'),
      ];
      expect(evaluateRideEligibility(rules(), input({ documents: docs }), now).eligible).toBe(true);
    });
    it('junta vários problemas sem repetir', () => {
      const r = evaluateRideEligibility(
        rules(),
        input({ vehicle: { type: 'CARRO', year: 2000 }, documents: [] }),
        now,
      );
      expect(r.problems).toEqual(['VEICULO_MUITO_VELHO', 'DOCUMENTO_FALTANDO']);
      expect(r.documentsToSend).toEqual(['CNH', 'DOCUMENTO_VEICULO', 'FOTO']);
    });
  });

  it('mulher verificada exige autodeclaração E conferência da associação', () => {
    expect(isVerifiedWoman('FEMININO', new Date())).toBe(true);
    expect(isVerifiedWoman('FEMININO', null)).toBe(false);
    expect(isVerifiedWoman('MASCULINO', new Date())).toBe(false);
    expect(isVerifiedWoman('NAO_INFORMADO', new Date())).toBe(false);
    expect(isVerifiedWoman(null, new Date())).toBe(false);
  });
});
