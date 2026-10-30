import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { canAccessSection, type PanelRole, type PanelSection } from '@amma/shared';
import { apiGet } from './api';

export interface Session {
  id: string;
  name: string | null;
  panelRoles: PanelRole[];
}

/** Quem está logado e com quais papéis de painel (a API é a fonte; cacheado por requisição). */
export const getSession = cache(async (): Promise<Session> => {
  const me = await apiGet<Session>('/panel/me');
  if (me.panelRoles.length === 0) redirect('/login?erro=sem-acesso');
  return me;
});

/** Barra quem não pode ver a área. A API repete a conferência em cada rota. */
export async function requireSection(section: PanelSection): Promise<Session> {
  const session = await getSession();
  if (!canAccessSection(session.panelRoles, section)) redirect('/sem-acesso');
  return session;
}

export const isAdmin = (s: Session) => s.panelRoles.includes('ADMIN');
