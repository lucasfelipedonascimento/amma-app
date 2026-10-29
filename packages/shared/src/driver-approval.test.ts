import { describe, expect, it } from 'vitest';
import { driverApproval, type DocumentInfo } from './driver-approval';

const doc = (
  type: DocumentInfo['type'],
  status: DocumentInfo['status'],
  day = 1,
): DocumentInfo => ({
  type,
  status,
  createdAt: `2026-10-0${day}T00:00:00Z`,
});

describe('driverApproval', () => {
  it('sem documentos: pendente e tudo faltando', () => {
    expect(driverApproval([])).toEqual({
      status: 'PENDENTE',
      missing: ['CNH', 'DOCUMENTO_VEICULO', 'FOTO'],
      rejected: [],
    });
  });
  it('todos aprovados: aprovado', () => {
    expect(
      driverApproval([
        doc('CNH', 'APROVADO'),
        doc('DOCUMENTO_VEICULO', 'APROVADO'),
        doc('FOTO', 'APROVADO'),
      ]).status,
    ).toBe('APROVADO');
  });
  it('um pendente: pendente', () => {
    expect(
      driverApproval([
        doc('CNH', 'APROVADO'),
        doc('DOCUMENTO_VEICULO', 'PENDENTE'),
        doc('FOTO', 'APROVADO'),
      ]).status,
    ).toBe('PENDENTE');
  });
  it('faltando um tipo, mesmo com os outros aprovados: pendente', () => {
    const r = driverApproval([doc('CNH', 'APROVADO'), doc('FOTO', 'APROVADO')]);
    expect(r.status).toBe('PENDENTE');
    expect(r.missing).toEqual(['DOCUMENTO_VEICULO']);
  });
  it('algum reprovado: reprovado, listando quais', () => {
    const r = driverApproval([
      doc('CNH', 'REPROVADO'),
      doc('DOCUMENTO_VEICULO', 'APROVADO'),
      doc('FOTO', 'APROVADO'),
    ]);
    expect(r.status).toBe('REPROVADO');
    expect(r.rejected).toEqual(['CNH']);
  });
  it('só o último envio de cada tipo vale (reenvio após reprovação)', () => {
    const r = driverApproval([
      doc('CNH', 'REPROVADO', 1),
      doc('CNH', 'PENDENTE', 2),
      doc('DOCUMENTO_VEICULO', 'APROVADO'),
      doc('FOTO', 'APROVADO'),
    ]);
    expect(r.status).toBe('PENDENTE');
    expect(r.rejected).toEqual([]);
  });
});
