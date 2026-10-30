import { describe, expect, it } from 'vitest';
import { apiErrorMessage, buildBody, type Field } from './form';
import { brl, dateOnly, monthLabel, parseMoneyToCents, percent, stars } from './format';
import { isFresh, jwtExpiry } from './jwt';
import { isAllowedProxyPath, isSameOrigin } from './proxy-rules';

const jwt = (exp: number) =>
  `x.${Buffer.from(JSON.stringify({ sub: 'u', exp })).toString('base64url')}.y`;

describe('jwt', () => {
  it('lê o exp', () => expect(jwtExpiry(jwt(123))).toBe(123));
  it('token malformado não quebra', () => {
    expect(jwtExpiry('lixo')).toBeNull();
    expect(jwtExpiry('a.!!!.c')).toBeNull();
  });
  it('fresco só com folga de 10 s', () => {
    const now = 1_000_000_000_000;
    expect(isFresh(jwt(now / 1000 + 60), now)).toBe(true);
    expect(isFresh(jwt(now / 1000 + 5), now)).toBe(false);
    expect(isFresh(jwt(now / 1000 - 5), now)).toBe(false);
    expect(isFresh(undefined, now)).toBe(false);
    expect(isFresh('lixo', now)).toBe(false);
  });
});

describe('proxy-rules', () => {
  it('só /admin e /panel', () => {
    expect(isAllowedProxyPath(['admin', 'users'])).toBe(true);
    expect(isAllowedProxyPath(['panel', 'budget'])).toBe(true);
    for (const p of [[], ['auth', 'refresh'], ['me'], ['ws'], ['health']])
      expect(isAllowedProxyPath(p)).toBe(false);
  });
  it('recusa tentativas de sair do caminho', () => {
    expect(isAllowedProxyPath(['admin', '..', 'auth'])).toBe(false);
    expect(isAllowedProxyPath(['admin', '%2e%2e'])).toBe(false);
    expect(isAllowedProxyPath(['admin', 'a\\b'])).toBe(false);
    expect(isAllowedProxyPath(['admin', ''])).toBe(false);
  });
  it('escrita só do mesmo site', () => {
    expect(isSameOrigin('GET', null, 'painel.amma.org')).toBe(true);
    expect(isSameOrigin('POST', 'https://painel.amma.org', 'painel.amma.org')).toBe(true);
    expect(isSameOrigin('POST', 'https://evil.example', 'painel.amma.org')).toBe(false);
    expect(isSameOrigin('POST', null, 'painel.amma.org')).toBe(false);
    expect(isSameOrigin('DELETE', 'não é url', 'painel.amma.org')).toBe(false);
  });
});

describe('format', () => {
  it('dinheiro em reais', () => {
    expect(brl(12345)).toMatch(/123,45/);
    expect(brl(null)).toBe('—');
  });
  it('valor digitado vira centavos', () => {
    expect(parseMoneyToCents('12,50')).toBe(1250);
    expect(parseMoneyToCents('R$ 1.234,56')).toBe(123456);
    expect(parseMoneyToCents('100')).toBe(10000);
    expect(parseMoneyToCents('0,5')).toBe(50);
    for (const bad of ['', 'abc', '0', '0,00', '-5', '1,234', '1.23,4', '12,5,0'])
      expect(parseMoneyToCents(bad), bad).toBeNull();
  });
  it('datas puras não mudam de dia', () => expect(dateOnly('2026-10-01')).toBe('01/10/2026'));
  it('percentual, nota e mês', () => {
    expect(percent(0.756)).toBe('76%');
    expect(percent(null)).toBe('—');
    expect(stars(4.5)).toBe('4,50 ★');
    expect(monthLabel('2026-10')).toBe('out/2026');
  });
});

describe('buildBody', () => {
  const fields: Field[] = [
    { name: 'reason', label: 'Motivo', type: 'textarea', minLength: 10 },
    { name: 'amountCents', label: 'Valor', type: 'money' },
    { name: 'q', label: 'Quórum', type: 'number', min: 0, max: 100, required: false },
    { name: 'removePoint', label: 'Remover', type: 'checkbox' },
  ];
  const ok = { reason: 'um motivo longo', amountCents: '12,50', q: '', removePoint: true };
  it('monta o corpo com tipos certos', () =>
    expect(buildBody(fields, ok)).toEqual({
      ok: true,
      body: { reason: 'um motivo longo', amountCents: 1250, removePoint: true },
    }));
  it('campo obrigatório vazio', () =>
    expect(buildBody(fields, { ...ok, reason: '  ' })).toEqual({
      ok: false,
      error: 'Preencha: Motivo',
    }));
  it('tamanho mínimo, valor e limites', () => {
    expect(buildBody(fields, { ...ok, reason: 'curto' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('pelo menos 10'),
    });
    expect(buildBody(fields, { ...ok, amountCents: 'abc' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('inválido'),
    });
    expect(buildBody(fields, { ...ok, q: '101' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('máximo 100'),
    });
    expect(buildBody(fields, { ...ok, q: '2,5' })).toMatchObject({ ok: false });
  });
  it('checkbox desmarcado vai como false', () =>
    expect(buildBody(fields, { ...ok, removePoint: false })).toMatchObject({
      body: { removePoint: false },
    }));
  it('data/hora vira ISO em UTC', () => {
    const r = buildBody([{ name: 'closesAt', label: 'Fim', type: 'datetime' }], {
      closesAt: '2026-12-01T10:00',
    });
    expect(r.ok && typeof r.body.closesAt === 'string' && r.body.closesAt.endsWith('Z')).toBe(true);
  });
});

describe('apiErrorMessage', () => {
  it('mensagens do Nest', () => {
    expect(apiErrorMessage({ message: ['a', 'b'] }, 400)).toBe('a; b');
    expect(apiErrorMessage({ message: 'Conta já bloqueada' }, 409)).toBe('Conta já bloqueada');
  });
  it('sem corpo, por status', () => {
    expect(apiErrorMessage(null, 403)).toMatch(/permissão/);
    expect(apiErrorMessage(null, 401)).toMatch(/Sessão/);
    expect(apiErrorMessage(null, 500)).toMatch(/500/);
  });
});
