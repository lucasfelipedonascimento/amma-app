import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Lê `CORS_ORIGINS` (origens separadas por vírgula, ex.: `https://amma.app,https://www.amma.app`).
 * Vazio = nenhuma origem de navegador é liberada. O app nativo não envia `Origin` e o painel
 * fala com a API pelo servidor dele, então o padrão seguro é negar.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/** Origem aceita só se estiver na lista exata (sem curinga). Sem `Origin` (app nativo, curl) passa: CORS não se aplica. */
export function corsOptions(allowed: string[]): CorsOptions {
  return {
    origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    // Autenticação é por Bearer no cabeçalho; nada de cookies entre origens.
    credentials: false,
    maxAge: 600,
  };
}
