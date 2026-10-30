import {
  formatDateTime,
  formatDistance,
  formatDuration,
  parseReaisToCents,
  secondsUntil,
  weekdayLabel,
} from '../format';

describe('formatDistance', () => {
  it('metros abaixo de 1 km, km com vírgula acima', () => {
    expect(formatDistance(312)).toBe('312 m');
    expect(formatDistance(2894)).toBe('2,9 km');
    expect(formatDistance(1000)).toBe('1,0 km');
  });
});

describe('formatDuration', () => {
  it('segundos, minutos e horas', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(417)).toBe('7 min');
    expect(formatDuration(3900)).toBe('1 h 05');
  });
});

describe('secondsUntil', () => {
  it('conta para cima e nunca fica negativo', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(secondsUntil('2026-10-29T12:00:30Z', now)).toBe(30);
    expect(secondsUntil('2026-10-29T12:00:00.500Z', now)).toBe(1);
    expect(secondsUntil('2026-10-29T11:59:00Z', now)).toBe(0);
  });
});

describe('datas', () => {
  it('dia da semana a partir da data do negócio', () => {
    expect(weekdayLabel('2026-10-29')).toBe('qui');
    expect(weekdayLabel('2026-10-25')).toBe('dom');
  });

  it('mostra no fuso de João Pessoa', () => {
    expect(formatDateTime('2026-10-29T18:30:00Z')).toBe('29/10 15:30');
    expect(formatDateTime('2026-10-30T01:05:00Z')).toBe('29/10 22:05');
  });
});

describe('parseReaisToCents', () => {
  it.each([
    ['12,50', 1250],
    ['R$ 12,5', 1250],
    ['12.50', 1250],
    ['1.234,56', 123456],
    ['0', 0],
    ['20', 2000],
  ])('%s → %i', (text, cents) => {
    expect(parseReaisToCents(text)).toBe(cents);
  });

  it('texto sem número é inválido', () => {
    expect(parseReaisToCents('')).toBeNull();
    expect(parseReaisToCents('abc')).toBeNull();
  });
});
