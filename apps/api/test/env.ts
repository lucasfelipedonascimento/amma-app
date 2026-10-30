import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Lê o .env da raiz só para o que ainda não estiver no ambiente (CI define as variáveis). */
function rootEnv(): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(resolve(__dirname, '../../../.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

const base = (k: string, fallback: string) => process.env[k] ?? rootEnv()[k] ?? fallback;

export const TEST_DB_NAME = 'amma_test';
export const TEST_REDIS_DB = 15;

/** URL do banco de testes: SEMPRE `amma_test`, nunca o banco de desenvolvimento. */
export function testDatabaseUrl(): string {
  const url = new URL(
    base('DATABASE_URL', 'postgresql://amma:amma_dev@localhost:5433/amma?schema=public'),
  );
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

export function adminDatabaseUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}

/** Redis de testes: índice 15, para nunca misturar com o de desenvolvimento. */
export function testRedisUrl(): string {
  const url = new URL(base('REDIS_URL', 'redis://localhost:6379'));
  url.pathname = `/${TEST_REDIS_DB}`;
  return url.toString();
}
