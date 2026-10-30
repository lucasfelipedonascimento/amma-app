/** Formatação de distância, tempo e datas para as telas do motorista (pt-BR). */

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Duração aproximada: "45 s", "8 min", "1 h 05". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** Segundos que faltam até `iso` (nunca negativo). */
export function secondsUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "2026-10-29" → "qui". O dia já vem no fuso do negócio, então usamos meio-dia UTC para não escorregar. */
export function weekdayLabel(day: string): string {
  return WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]!;
}

/** "2026-10-29T18:30:00Z" → "29/10 15:30" no fuso de João Pessoa (UTC−3). */
export function formatDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Texto digitado em reais ("12,50", "R$ 12.5") → centavos. null se não for um valor válido. */
export function parseReaisToCents(text: string): number | null {
  const clean = text.replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '');
  if (!clean) return null;
  const n = Number(clean.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
