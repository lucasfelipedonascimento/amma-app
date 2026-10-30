/** Validações de entrada usadas na API e no app (sem dependências). */

/** Normaliza celular brasileiro para E.164 (+55DDNXXXXXXXX). Retorna null se inválido. */
export function normalizeBrazilPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55'))
    digits = digits.slice(2);
  if (digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (digits[2] !== '9') return null; // celular
  return `+55${digits}`;
}

/** CPF com dígitos verificadores. */
export function isValidCpf(input: string): boolean {
  const d = input.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23). */
export function normalizePlate(input: string): string | null {
  const p = input.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]{3}\d{4}$/.test(p) || /^[A-Z]{3}\d[A-Z]\d{2}$/.test(p) ? p : null;
}

export function isValidVehicleYear(year: number, now = new Date()): boolean {
  return Number.isInteger(year) && year >= 1980 && year <= now.getUTCFullYear() + 1;
}

// ---------- Máscaras de digitação (o usuário digita só números/letras; as marcas entram sozinhas) ----------

/** 12345678909 → 123.456.789-09 (aceita digitação parcial). */
export function maskCpf(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 11);
  const p = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join('.');
  return d.length > 9 ? `${p}-${d.slice(9)}` : p;
}

/** 19092001 → 19/09/2001 (aceita digitação parcial). */
export function maskDate(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

/** abc1d23 → ABC1D23 (só letras e números, até 7). Serve para placa antiga e Mercosul. */
export function maskPlate(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 7);
}

/** "19/09/2001" → "2001-09-19"; null se o formato ou a data (ex.: 31/02) forem inválidos. */
export function parseBrDate(input: string): string | null {
  const m = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real && year >= 1900 ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
