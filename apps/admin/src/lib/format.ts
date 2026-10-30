const TZ = 'America/Fortaleza';

export const brl = (cents: number | null | undefined): string =>
  cents == null
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dateOnly(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const s = typeof iso === 'string' ? iso : iso.toISOString();
  // Datas "puras" (YYYY-MM-DD) não passam por fuso: evita mostrar o dia anterior.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
  return new Date(s).toLocaleDateString('pt-BR', { timeZone: TZ });
}

export const percent = (ratio: number | null | undefined): string =>
  ratio == null ? '—' : `${Math.round(ratio * 100)}%`;

export const stars = (avg: number | null | undefined): string =>
  avg == null ? '—' : `${avg.toFixed(2).replace('.', ',')} ★`;

/** "12,50" ou "1.234,56" → centavos. null se não for um valor válido (> 0, até 2 casas). */
export function parseMoneyToCents(input: string): number | null {
  const t = input.trim().replace(/^R\$\s*/, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return null;
  const [int, frac = ''] = t.replace(/\./g, '').split(',');
  const cents = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** Mês "2026-10" → "out/2026". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${name.replace('.', '')}/${y}`;
}
