import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security-headers';

function run(production: boolean) {
  const headers = new Map<string, string>();
  const removed: string[] = [];
  let called = false;
  securityHeaders(production)(
    {},
    { setHeader: (k, v) => headers.set(k, v), removeHeader: (k) => removed.push(k) },
    () => (called = true),
  );
  return { headers, removed, called };
}

describe('cabeçalhos de segurança', () => {
  it('sempre: nosniff, sem moldura, sem referrer, sem X-Powered-By', () => {
    const { headers, removed, called } = run(false);
    expect(called).toBe(true);
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(removed).toContain('X-Powered-By');
    expect(headers.has('Strict-Transport-Security')).toBe(false);
  });
  it('HSTS só em produção', () => {
    expect(run(true).headers.get('Strict-Transport-Security')).toContain('max-age=');
  });
});
