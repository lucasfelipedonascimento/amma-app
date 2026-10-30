/** Lê o `exp` (segundos) de um JWT SEM validar a assinatura: só decide quando renovar. Quem valida é a API. */
export function jwtExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/** Token ainda vale por pelo menos `marginSeconds`? */
export function isFresh(token: string | undefined, now = Date.now(), marginSeconds = 10): boolean {
  if (!token) return false;
  const exp = jwtExpiry(token);
  return exp !== null && exp * 1000 > now + marginSeconds * 1000;
}
