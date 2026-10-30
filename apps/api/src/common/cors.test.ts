import { describe, expect, it } from 'vitest';
import { corsOptions, parseCorsOrigins } from './cors';

const allows = (allowed: string[], origin?: string) =>
  new Promise<boolean>((resolve) => {
    const o = corsOptions(allowed).origin as (
      origin: string | undefined,
      cb: (err: Error | null, ok?: boolean) => void,
    ) => void;
    o(origin, (_e, ok) => resolve(Boolean(ok)));
  });

describe('CORS', () => {
  it('lê a lista, ignora vazios e barra final', () => {
    expect(parseCorsOrigins(' https://a.com/ , ,https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
    expect(parseCorsOrigins(undefined)).toEqual([]);
  });

  it('sem lista, nenhuma origem de navegador passa', async () => {
    expect(await allows([], 'https://evil.com')).toBe(false);
  });

  it('só aceita a origem exata da lista', async () => {
    const list = ['https://amma.app'];
    expect(await allows(list, 'https://amma.app')).toBe(true);
    expect(await allows(list, 'https://amma.app.evil.com')).toBe(false);
    expect(await allows(list, 'http://amma.app')).toBe(false);
  });

  it('sem Origin (app nativo) não é bloqueado e não há credenciais entre origens', async () => {
    expect(await allows([], undefined)).toBe(true);
    expect(corsOptions([]).credentials).toBe(false);
  });
});
