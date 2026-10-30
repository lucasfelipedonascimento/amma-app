import { describe, expect, it } from 'vitest';
import {
  categoryAllows,
  evaluateVerification,
  namesMatch,
  type ReaderAnalysis,
  type VerificationContext,
} from './document-verification';

const profile = { cpf: '52998224725', fullName: 'João da Silva Santos', birthDate: '1990-02-01' };
const vehicle = { plate: 'BRA2E15', year: 2021, type: 'MOTO' as const };
const gov = (status = 'CONFIRMADO', provider = 'serpro') => [
  { scope: 'CNH', provider, status: status as 'CONFIRMADO' },
];

const cnh = (over: Partial<ReaderAnalysis> = {}, fields = {}): ReaderAnalysis => ({
  kind: 'CNH',
  engine: 'text-layer',
  readable: true,
  fields: {
    name: 'JOAO DA SILVA SANTOS',
    cpf: '52998224725',
    birthDate: '1990-02-01',
    category: 'AB',
    hasEar: true,
    ...fields,
  },
  checks: [
    { code: 'CPF_VALIDO', ok: true },
    { code: 'REGISTRO_VALIDO', ok: true },
    { code: 'CNH_VIGENTE', ok: true },
  ],
  government: gov(),
  ...over,
});
const crlv = (over: Partial<ReaderAnalysis> = {}, fields = {}): ReaderAnalysis => ({
  kind: 'CRLV',
  engine: 'text-layer',
  readable: true,
  fields: {
    plate: 'BRA2E15',
    yearModel: 2021,
    yearManufacture: 2020,
    ownerCpf: '52998224725',
    ...fields,
  },
  checks: [
    { code: 'RENAVAM_VALIDO', ok: true },
    { code: 'CRLV_EM_DIA', ok: true },
  ],
  government: gov(),
  ...over,
});
const ctxCnh: VerificationContext = { type: 'CNH', profile, vehicle };
const ctxCrlv: VerificationContext = { type: 'DOCUMENTO_VEICULO', profile, vehicle };
const level = (r: ReturnType<typeof evaluateVerification>, code: string) =>
  r.findings.find((f) => f.code === code)?.level;

describe('namesMatch', () => {
  it('ignora acento, caixa e partículas', () => {
    expect(namesMatch('JOAO DA SILVA SANTOS', 'João Silva Santos')).toBe(true);
  });
  it('recusa nomes diferentes ou curtos demais', () => {
    expect(namesMatch('MARIA SOUZA LIMA', 'João da Silva Santos')).toBe(false);
    expect(namesMatch('JOAO', 'JOAO')).toBe(false);
    expect(namesMatch('JOAO SILVA', 'JOAO PEREIRA')).toBe(false);
  });
});

describe('categoryAllows', () => {
  it('moto precisa de A; ACC sozinha não serve', () => {
    expect(categoryAllows('A', 'MOTO')).toBe(true);
    expect(categoryAllows('AB', 'MOTO')).toBe(true);
    expect(categoryAllows('B', 'MOTO')).toBe(false);
    expect(categoryAllows('ACC', 'MOTO')).toBe(false);
  });
  it('carro precisa de B, C, D ou E', () => {
    expect(categoryAllows('B', 'CARRO')).toBe(true);
    expect(categoryAllows('D', 'CARRO')).toBe(true);
    expect(categoryAllows('A', 'CARRO')).toBe(false);
  });
});

describe('evaluateVerification — CNH', () => {
  it('tudo certo e conferido em base real: APROVAR', () => {
    const r = evaluateVerification(cnh(), ctxCnh);
    expect(r.recommendation).toBe('APROVAR');
    expect(r.findings.every((f) => f.level === 'OK')).toBe(true);
  });
  it('CPF de outra pessoa: FALHA', () => {
    const r = evaluateVerification(cnh({}, { cpf: '11144477735' }), ctxCnh);
    expect(r.recommendation).toBe('REVISAR');
    expect(level(r, 'CPF')).toBe('FALHA');
  });
  it('nome, nascimento, categoria e validade divergentes', () => {
    const r = evaluateVerification(
      cnh(
        {
          checks: [
            { code: 'CPF_VALIDO', ok: true },
            { code: 'REGISTRO_VALIDO', ok: true },
            { code: 'CNH_VIGENTE', ok: false },
          ],
        },
        { name: 'PEDRO ALVES', birthDate: '1991-02-01', category: 'B' },
      ),
      ctxCnh,
    );
    expect(['NOME', 'NASCIMENTO', 'CATEGORIA', 'VALIDADE'].map((c) => level(r, c))).toEqual([
      'FALHA',
      'FALHA',
      'FALHA',
      'FALHA',
    ]);
  });
  it('sem EAR: só alerta, mas não aprova', () => {
    const r = evaluateVerification(cnh({}, { hasEar: false }), ctxCnh);
    expect(level(r, 'EAR')).toBe('ALERTA');
    expect(r.recommendation).toBe('REVISAR');
  });
  it('base oficial simulada ou fora do ar nunca aprova; divergente é falha', () => {
    expect(
      evaluateVerification(cnh({ government: gov('CONFIRMADO', 'sandbox') }), ctxCnh)
        .recommendation,
    ).toBe('REVISAR');
    expect(
      evaluateVerification(cnh({ government: gov('INDISPONIVEL') }), ctxCnh).recommendation,
    ).toBe('REVISAR');
    expect(evaluateVerification(cnh({ government: [] }), ctxCnh).recommendation).toBe('REVISAR');
    const r = evaluateVerification(cnh({ government: gov('DIVERGENTE') }), ctxCnh);
    expect(level(r, 'BASE_OFICIAL')).toBe('FALHA');
  });
  it('ilegível ou documento trocado: revisar', () => {
    expect(evaluateVerification(cnh({ readable: false }), ctxCnh).recommendation).toBe('REVISAR');
    expect(level(evaluateVerification(crlv(), ctxCnh), 'TIPO')).toBe('FALHA');
  });
});

describe('evaluateVerification — CRLV', () => {
  it('tudo certo: APROVAR', () => {
    expect(evaluateVerification(crlv(), ctxCrlv).recommendation).toBe('APROVAR');
  });
  it('placa diferente do veículo cadastrado: FALHA', () => {
    expect(level(evaluateVerification(crlv({}, { plate: 'ABC1234' }), ctxCrlv), 'PLACA')).toBe(
      'FALHA',
    );
  });
  it('proprietário diferente: alerta (veículo de família/associação), não falha', () => {
    const r = evaluateVerification(crlv({}, { ownerCpf: '11144477735' }), ctxCrlv);
    expect(level(r, 'PROPRIETARIO')).toBe('ALERTA');
    expect(r.recommendation).toBe('REVISAR');
  });
  it('licenciamento antigo e RENAVAM inválido: FALHA', () => {
    const r = evaluateVerification(
      crlv({
        checks: [
          { code: 'RENAVAM_VALIDO', ok: false },
          { code: 'CRLV_EM_DIA', ok: false },
        ],
      }),
      ctxCrlv,
    );
    expect(level(r, 'RENAVAM')).toBe('FALHA');
    expect(level(r, 'LICENCIAMENTO')).toBe('FALHA');
  });
});
