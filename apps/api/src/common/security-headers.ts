/** Cabeçalhos de segurança da API (equivalente enxuto ao helmet, sem dependência nova). */
export function securityHeaders(production: boolean) {
  return (
    _req: unknown,
    res: { setHeader(k: string, v: string): void; removeHeader(k: string): void },
    next: () => void,
  ) => {
    res.removeHeader('X-Powered-By');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    // HSTS só em produção (em desenvolvimento a API roda em http).
    if (production)
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
