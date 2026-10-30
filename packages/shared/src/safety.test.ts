import { describe, expect, it } from 'vitest';
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABEL,
  isSevereReport,
  tripRecordExpiry,
  TRIP_RECORD_RETENTION_DAYS,
} from './safety';
import { RATING_MIN_COUNT_FOR_AVERAGE, ratingSummary } from './rating';

describe('segurança', () => {
  it('toda categoria de denúncia tem texto; violência e assédio são graves, cobrança não', () => {
    for (const c of REPORT_CATEGORIES) expect(REPORT_CATEGORY_LABEL[c]).toBeTruthy();
    expect(isSevereReport('VIOLENCIA')).toBe(true);
    expect(isSevereReport('ASSEDIO')).toBe(true);
    expect(isSevereReport('COBRANCA_INDEVIDA')).toBe(false);
  });
  it('registro da viagem expira em 90 dias', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    expect(now.getTime() - tripRecordExpiry(now).getTime()).toBe(
      TRIP_RECORD_RETENTION_DAYS * 86_400_000,
    );
  });
});

describe('resumo de avaliações', () => {
  it('sem notas suficientes mostra só a quantidade', () => {
    expect(ratingSummary([])).toEqual({ average: null, count: 0 });
    expect(ratingSummary([5, 5])).toEqual({ average: null, count: 2 });
    expect(RATING_MIN_COUNT_FOR_AVERAGE).toBe(3);
  });
  it('a partir de 3 notas mostra a média (arredondada para baixo)', () => {
    expect(ratingSummary([5, 5, 4])).toEqual({ average: 4.6, count: 3 });
  });
});
