import { describe, expect, it } from 'vitest';
import { Ledger, buildHostBenefit, hostDiscountAccount, workerBalanceAccount } from './ledger';
import {
  CHECKIN_RADIUS_METERS,
  HOST_BENEFIT_MONTHLY_CAP_CENTS,
  HOST_BENEFIT_PER_VISIT_CENTS,
  HOUSE_CHECKLIST,
  approximatePoint,
  hasHost,
  hostBenefitCents,
  initialPointStatus,
  isOpenAt,
  matchesFilter,
  missingChecklistItems,
  startOfMonthJoaoPessoa,
  suspensionReason,
  validateHours,
  withinCheckinRadius,
  type FilterablePoint,
  type OpeningHours,
} from './welcome-point';

// 2026-11-02 é segunda-feira. João Pessoa = UTC−3.
const jp = (iso: string) => new Date(`${iso}-03:00`);
const comercial: OpeningHours = {
  always: false,
  slots: [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '18:00' }],
};

describe('tipos e status inicial', () => {
  it('só a casa parceira espera aprovação', () => {
    expect(initialPointStatus('CASA_PARCEIRA')).toBe('EM_ANALISE');
    expect(initialPointStatus('COMERCIO')).toBe('ATIVO');
    expect(initialPointStatus('ESPACO_PUBLICO')).toBe('ATIVO');
  });
  it('espaço público não tem anfitrião', () => {
    expect(hasHost('ESPACO_PUBLICO')).toBe(false);
    expect(hasHost('CASA_PARCEIRA')).toBe(true);
    expect(hasHost('COMERCIO')).toBe(true);
  });
});

describe('horário de funcionamento', () => {
  it('valida o formato', () => {
    expect(validateHours(comercial)).toBeNull();
    expect(validateHours({ always: true, slots: [] })).toBeNull();
    expect(validateHours(null)).toMatch(/horário/);
    expect(validateHours({ always: true, slots: comercial.slots })).toMatch(/24 horas/);
    expect(validateHours({ always: false, slots: [] })).toMatch(/1 a 14/);
    const slot = (over: object) => ({
      always: false,
      slots: [{ days: [1], open: '08:00', close: '18:00', ...over }],
    });
    expect(validateHours(slot({ days: [] }))).toMatch(/dias/);
    expect(validateHours(slot({ days: [1, 1] }))).toMatch(/repetido/);
    expect(validateHours(slot({ days: [7] }))).toMatch(/Dia da semana/);
    expect(validateHours(slot({ open: '8h' }))).toMatch(/Abertura/);
    expect(validateHours(slot({ close: '24:00' }))).toMatch(/Fechamento/);
    expect(validateHours(slot({ close: '08:00' }))).toMatch(/iguais/);
  });

  it('aberto dentro da faixa, fechado fora e nos dias sem faixa', () => {
    expect(isOpenAt(comercial, jp('2026-11-02T09:00:00'))).toBe(true);
    expect(isOpenAt(comercial, jp('2026-11-02T07:59:00'))).toBe(false);
    expect(isOpenAt(comercial, jp('2026-11-02T18:00:00'))).toBe(false); // fechamento é exclusivo
    expect(isOpenAt(comercial, jp('2026-11-01T10:00:00'))).toBe(false); // domingo
  });

  it('usa o horário de João Pessoa, não o UTC', () => {
    // 11:00 UTC = 08:00 em João Pessoa.
    expect(isOpenAt(comercial, new Date('2026-11-02T11:00:00Z'))).toBe(true);
    expect(isOpenAt(comercial, new Date('2026-11-02T10:59:00Z'))).toBe(false);
  });

  it('faixa que vira a noite vale até o fechamento do dia seguinte', () => {
    const noite: OpeningHours = {
      always: false,
      slots: [{ days: [5], open: '22:00', close: '04:00' }], // sexta
    };
    expect(isOpenAt(noite, jp('2026-11-06T23:00:00'))).toBe(true); // sexta 23h
    expect(isOpenAt(noite, jp('2026-11-07T03:00:00'))).toBe(true); // sábado 3h (resto da faixa de sexta)
    expect(isOpenAt(noite, jp('2026-11-07T04:00:00'))).toBe(false);
    expect(isOpenAt(noite, jp('2026-11-07T23:00:00'))).toBe(false); // sábado 23h: sem faixa
    expect(isOpenAt(noite, jp('2026-11-06T03:00:00'))).toBe(false); // quinta 3h
  });

  it('24 horas está sempre aberto', () => {
    expect(isOpenAt({ always: true, slots: [] }, jp('2026-11-01T03:00:00'))).toBe(true);
  });
});

describe('casa parceira', () => {
  it('checklist: todos os itens são obrigatórios', () => {
    const all = Object.fromEntries(HOUSE_CHECKLIST.map((i) => [i.key, true]));
    expect(missingChecklistItems(all)).toEqual([]);
    expect(missingChecklistItems({ ...all, SEM_COBRANCA: false })).toEqual(['SEM_COBRANCA']);
    expect(missingChecklistItems({})).toHaveLength(HOUSE_CHECKLIST.length);
    expect(missingChecklistItems(null)).toHaveLength(HOUSE_CHECKLIST.length);
    expect(missingChecklistItems({ ...all, AREA_SEPARADA: 'sim' })).toEqual(['AREA_SEPARADA']);
  });

  it('a posição da casa é arredondada (~110 m)', () => {
    expect(approximatePoint({ lat: -7.11537, lng: -34.86149 })).toEqual({
      lat: -7.115,
      lng: -34.861,
    });
  });
});

describe('check-in', () => {
  const point = { lat: -7.115, lng: -34.861 };
  it('vale só perto do ponto', () => {
    expect(withinCheckinRadius(point, point)).toBe(true);
    const at = (m: number) => ({ lat: point.lat + m / 111_000, lng: point.lng });
    expect(withinCheckinRadius(at(CHECKIN_RADIUS_METERS - 20), point)).toBe(true);
    expect(withinCheckinRadius(at(CHECKIN_RADIUS_METERS + 50), point)).toBe(false);
  });
});

describe('benefício do anfitrião', () => {
  it('rende o valor da visita até o teto do mês', () => {
    expect(hostBenefitCents(0)).toBe(HOST_BENEFIT_PER_VISIT_CENTS);
    expect(hostBenefitCents(HOST_BENEFIT_MONTHLY_CAP_CENTS - 40)).toBe(40);
    expect(hostBenefitCents(HOST_BENEFIT_MONTHLY_CAP_CENTS)).toBe(0);
    expect(hostBenefitCents(HOST_BENEFIT_MONTHLY_CAP_CENTS + 500)).toBe(0);
    expect(hostBenefitCents(-10)).toBe(HOST_BENEFIT_PER_VISIT_CENTS);
  });

  it('o mês começa à meia-noite de João Pessoa', () => {
    expect(startOfMonthJoaoPessoa(new Date('2026-11-15T12:00:00Z')).toISOString()).toBe(
      '2026-11-01T03:00:00.000Z',
    );
    // 1º de novembro 01:00 UTC ainda é 31 de outubro em João Pessoa.
    expect(startOfMonthJoaoPessoa(new Date('2026-11-01T01:00:00Z')).toISOString()).toBe(
      '2026-10-01T03:00:00.000Z',
    );
  });

  it('o lançamento fecha as contas e vai para o saldo ou para o desconto', () => {
    const ledger = new Ledger();
    ledger.post(
      buildHostBenefit({
        id: 't1',
        checkInId: 'c1',
        hostId: 'h',
        kind: 'CREDITO',
        amountCents: 100,
        createdAt: '2026-11-01T00:00:00Z',
      }),
    );
    ledger.post(
      buildHostBenefit({
        id: 't2',
        checkInId: 'c2',
        hostId: 'h',
        kind: 'DESCONTO',
        amountCents: 70,
        createdAt: '2026-11-01T00:00:00Z',
      }),
    );
    expect(ledger.creditBalance(workerBalanceAccount('h'))).toBe(100);
    expect(ledger.creditBalance(hostDiscountAccount('h'))).toBe(70);
    expect(ledger.debitBalance('ASSOCIATION_HOST_BENEFITS')).toBe(170);
  });
});

describe('quando o ponto sai do mapa', () => {
  const report = (reporterId: string, category: 'OUTRO' | 'SEGURANCA' | 'ASSEDIO' = 'OUTRO') => ({
    reporterId,
    category,
  });
  it('sem problema não suspende', () => {
    expect(suspensionReason({ stars: [], openReports: [] })).toBeNull();
    expect(
      suspensionReason({ stars: [5, 4, 5], openReports: [report('a'), report('b')] }),
    ).toBeNull();
  });
  it('denúncia grave suspende na hora', () => {
    expect(suspensionReason({ stars: [], openReports: [report('a', 'SEGURANCA')] })).toBe(
      'DENUNCIA_GRAVE',
    );
    expect(suspensionReason({ stars: [], openReports: [report('a', 'ASSEDIO')] })).toBe(
      'DENUNCIA_GRAVE',
    );
  });
  it('3 denunciantes diferentes suspendem; a mesma pessoa 3 vezes não', () => {
    expect(
      suspensionReason({ stars: [], openReports: [report('a'), report('b'), report('c')] }),
    ).toBe('DENUNCIAS');
    expect(
      suspensionReason({ stars: [], openReports: [report('a'), report('a'), report('a')] }),
    ).toBeNull();
  });
  it('nota baixa só conta com avaliações suficientes', () => {
    expect(suspensionReason({ stars: [1, 1, 1, 1], openReports: [] })).toBeNull();
    expect(suspensionReason({ stars: [1, 1, 1, 1, 1], openReports: [] })).toBe('NOTA_BAIXA');
    expect(suspensionReason({ stars: [1, 2, 2, 2, 3], openReports: [] })).toBeNull(); // média 2,0
    expect(suspensionReason({ stars: [1, 2, 2, 2, 2], openReports: [] })).toBe('NOTA_BAIXA'); // 1,8
  });
});

describe('filtros do mapa', () => {
  const p: FilterablePoint = {
    type: 'COMERCIO',
    amenities: ['AGUA', 'BANHEIRO'],
    hours: comercial,
    average: 4.2,
  };
  const now = jp('2026-11-02T10:00:00');
  it('tipo', () => {
    expect(matchesFilter(p, { types: ['COMERCIO'] }, now)).toBe(true);
    expect(matchesFilter(p, { types: ['CASA_PARCEIRA'] }, now)).toBe(false);
    expect(matchesFilter(p, { types: [] }, now)).toBe(true);
  });
  it('comodidades: precisa ter todas', () => {
    expect(matchesFilter(p, { amenities: ['AGUA'] }, now)).toBe(true);
    expect(matchesFilter(p, { amenities: ['AGUA', 'CARREGADOR'] }, now)).toBe(false);
  });
  it('aberto agora', () => {
    expect(matchesFilter(p, { openNow: true }, now)).toBe(true);
    expect(matchesFilter(p, { openNow: true }, jp('2026-11-02T20:00:00'))).toBe(false);
  });
  it('nota mínima; sem média ainda passa', () => {
    expect(matchesFilter(p, { minRating: 4 }, now)).toBe(true);
    expect(matchesFilter(p, { minRating: 4.5 }, now)).toBe(false);
    expect(matchesFilter({ ...p, average: null }, { minRating: 4.5 }, now)).toBe(true);
  });
});
