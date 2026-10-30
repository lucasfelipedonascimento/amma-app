import { parseMoneyToCents } from './format';

export type FieldType =
  'text' | 'textarea' | 'select' | 'number' | 'money' | 'date' | 'datetime' | 'checkbox';

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: readonly { value: string; label: string }[];
  min?: number;
  max?: number;
  /** Mínimo de caracteres (texto). */
  minLength?: number;
  hint?: string;
  defaultValue?: string | boolean;
}

export type FormValues = Record<string, string | boolean>;

/** Valida os campos e monta o corpo JSON do pedido. Devolve a 1ª mensagem de erro, se houver. */
export function buildBody(
  fields: readonly Field[],
  values: FormValues,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (f.type === 'checkbox') {
      body[f.name] = raw === true;
      continue;
    }
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      if (f.required !== false) return { ok: false, error: `Preencha: ${f.label}` };
      continue;
    }
    switch (f.type) {
      case 'money': {
        const cents = parseMoneyToCents(text);
        if (cents === null)
          return { ok: false, error: `${f.label}: valor inválido (ex.: 1.250,00)` };
        body[f.name] = cents;
        break;
      }
      case 'number': {
        const n = Number(text.replace(',', '.'));
        if (!Number.isInteger(n)) return { ok: false, error: `${f.label}: use um número inteiro` };
        if (f.min !== undefined && n < f.min)
          return { ok: false, error: `${f.label}: mínimo ${f.min}` };
        if (f.max !== undefined && n > f.max)
          return { ok: false, error: `${f.label}: máximo ${f.max}` };
        body[f.name] = n;
        break;
      }
      case 'datetime': {
        const d = new Date(text);
        if (Number.isNaN(d.getTime())) return { ok: false, error: `${f.label}: data inválida` };
        body[f.name] = d.toISOString();
        break;
      }
      default:
        if (f.minLength && text.length < f.minLength)
          return { ok: false, error: `${f.label}: escreva pelo menos ${f.minLength} caracteres` };
        body[f.name] = text;
    }
  }
  return { ok: true, body };
}

/** Mensagem legível a partir do corpo de erro da API (Nest devolve string ou lista). */
export function apiErrorMessage(body: unknown, status: number): string {
  const m = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(m)) return m.join('; ');
  if (typeof m === 'string') return m;
  if (status === 401) return 'Sessão expirada. Entre de novo.';
  if (status === 403) return 'Sem permissão para esta ação.';
  return `Erro inesperado (${status}).`;
}
