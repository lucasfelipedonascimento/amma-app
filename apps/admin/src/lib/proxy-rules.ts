/** Partes da API que o navegador pode alcançar pelo proxy. Quem decide o acesso de fato é a API. */
const ALLOWED_ROOTS = ['admin', 'panel'];

export function isAllowedProxyPath(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  if (segments.some((s) => s === '' || s === '.' || s === '..' || /[\\/%]/.test(s))) return false;
  return ALLOWED_ROOTS.includes(segments[0]);
}

/**
 * Defesa extra contra CSRF (além do cookie SameSite=Strict): pedido que muda dados só vale se vier
 * do próprio painel (cabeçalho Origin com o mesmo host).
 */
export function isSameOrigin(method: string, origin: string | null, host: string | null): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
