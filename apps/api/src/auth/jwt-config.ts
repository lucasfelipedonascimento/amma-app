import type { JwtModuleOptions } from '@nestjs/jwt';
import { ACCESS_TTL } from './refresh';

export const JWT_ISSUER = 'amma-api';
export const JWT_AUDIENCE = 'amma-app';
const MIN_SECRET_LENGTH = 32;
const KNOWN_WEAK = ['segredo-de-teste', 'changeme', 'secret', 'troque'];

/** Em produção o segredo precisa ser longo e não pode ser um valor de exemplo. */
export function assertJwtSecret(secret: string | undefined, nodeEnv: string | undefined): string {
  if (!secret) throw new Error('JWT_SECRET não definido (veja .env.example)');
  if (nodeEnv === 'production') {
    if (secret.length < MIN_SECRET_LENGTH)
      throw new Error(`JWT_SECRET deve ter ao menos ${MIN_SECRET_LENGTH} caracteres em produção`);
    if (KNOWN_WEAK.some((w) => secret.toLowerCase().includes(w)))
      throw new Error('JWT_SECRET parece um valor de exemplo; gere um novo (openssl rand -hex 32)');
  }
  return secret;
}

/** Algoritmo, emissor e audiência fixos na assinatura E na verificação (nada vem do token). */
export function jwtOptions(secret: string): JwtModuleOptions {
  return {
    secret,
    signOptions: {
      expiresIn: ACCESS_TTL,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    },
    verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
  };
}
