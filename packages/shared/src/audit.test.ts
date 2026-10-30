import { describe, expect, it } from 'vitest';
import { auditAction, auditLabel, shouldAudit } from './audit';

describe('trilha de auditoria', () => {
  it('toda escrita entra', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(shouldAudit(m, '/admin/qualquer')).toBe(true);
  });
  it('leitura comum não entra, leitura de dado sensível sim', () => {
    expect(shouldAudit('GET', '/admin/documents')).toBe(false);
    expect(shouldAudit('GET', '/admin/documents/:id/file')).toBe(true);
    expect(shouldAudit('get', '/admin/rides/:id/trip-record')).toBe(true);
  });
  it('rótulo em português, com a rota como reserva', () => {
    expect(auditLabel(auditAction('post', '/admin/users/:id/block'))).toBe('Bloqueou conta');
    expect(auditLabel('POST /admin/novo')).toBe('POST /admin/novo');
  });
});
