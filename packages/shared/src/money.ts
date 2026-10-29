// Dinheiro SEMPRE em centavos (inteiros). Nunca usar float para valores.
export type Cents = number;

export function assertCents(value: number, name = 'valor'): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} deve ser um inteiro não negativo em centavos`);
  }
}

export function formatBRL(cents: Cents): string {
  if (!Number.isInteger(cents)) throw new Error('Valor em centavos deve ser inteiro');
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
