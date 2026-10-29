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
