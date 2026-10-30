import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  cache: <T>(f: T) => f,
}));
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
const apiGet = vi.fn();
vi.mock('./api', () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));

import { getSession, requireSection } from './session';

beforeEach(() => {
  redirect.mockClear();
  apiGet.mockReset();
});

describe('requireSection: acesso por papel nas páginas', () => {
  it('admin entra em qualquer área', async () => {
    apiGet.mockResolvedValue({ id: '1', name: 'Ana', panelRoles: ['ADMIN'] });
    for (const s of ['usuarios', 'auditoria', 'motoristas', 'orcamento'] as const)
      await expect(requireSection(s)).resolves.toMatchObject({ id: '1' });
  });

  it('sócio entra nas áreas abertas e é barrado nas demais', async () => {
    apiGet.mockResolvedValue({ id: '2', name: 'Beto', panelRoles: ['SOCIO'] });
    for (const s of ['painel', 'assembleias', 'compra-coletiva', 'orcamento'] as const)
      await expect(requireSection(s)).resolves.toBeTruthy();
    for (const s of [
      'motoristas',
      'comerciantes',
      'acolhida',
      'denuncias',
      'usuarios',
      'auditoria',
    ] as const)
      await expect(requireSection(s)).rejects.toThrow('REDIRECT:/sem-acesso');
  });

  it('sem papel de painel volta para o login', async () => {
    apiGet.mockResolvedValue({ id: '3', name: 'Zé', panelRoles: [] });
    await expect(getSession()).rejects.toThrow('REDIRECT:/login?erro=sem-acesso');
  });
});
