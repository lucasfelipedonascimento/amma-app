import { describe, expect, it } from 'vitest';
import { canAccessSection, panelRolesFor, sectionOfPath, sectionsFor } from './panel-access';

describe('panelRolesFor', () => {
  it('admin', () => expect(panelRolesFor(['ADMIN'], false)).toEqual(['ADMIN']));
  it('motorista com cotas é sócio', () =>
    expect(panelRolesFor(['MOTORISTA'], true)).toEqual(['SOCIO']));
  it('motorista sem cotas não entra', () =>
    expect(panelRolesFor(['MOTORISTA'], false)).toEqual([]));
  it('cotas sem ser motorista não contam', () =>
    expect(panelRolesFor(['PASSAGEIRO'], true)).toEqual([]));
  it('admin e sócio ao mesmo tempo', () =>
    expect(panelRolesFor(['ADMIN', 'MOTORISTA'], true)).toEqual(['ADMIN', 'SOCIO']));
});

describe('acesso por área', () => {
  it('sócio só vê transparência', () => {
    expect(sectionsFor(['SOCIO'])).toEqual([
      'painel',
      'assembleias',
      'compra-coletiva',
      'orcamento',
    ]);
    for (const s of [
      'motoristas',
      'comerciantes',
      'acolhida',
      'denuncias',
      'usuarios',
      'auditoria',
    ] as const)
      expect(canAccessSection(['SOCIO'], s)).toBe(false);
  });
  it('admin vê tudo', () => expect(sectionsFor(['ADMIN'])).toHaveLength(11));
  it('sem papel não vê nada', () => expect(sectionsFor([])).toEqual([]));
});

describe('sectionOfPath', () => {
  it('reconhece a área', () => {
    expect(sectionOfPath('/orcamento')).toBe('orcamento');
    expect(sectionOfPath('/usuarios/abc')).toBe('usuarios');
    expect(sectionOfPath('/')).toBe('painel');
  });
  it('rota desconhecida', () => expect(sectionOfPath('/login')).toBeNull());
});
