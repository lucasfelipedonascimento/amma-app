/**
 * Controle de acesso do painel web. Dois papéis de painel:
 * - ADMIN: papel `ADMIN` do usuário; vê e faz tudo.
 * - SOCIO: motorista com ao menos 1 cota (ver membership.ts); só LÊ o que a associação abre aos sócios.
 * A API confere sempre; o painel usa as mesmas regras só para esconder o que a pessoa não pode usar.
 */
export const PANEL_ROLES = ['ADMIN', 'SOCIO'] as const;
export type PanelRole = (typeof PANEL_ROLES)[number];

/** Áreas do painel. A chave é também o primeiro trecho da rota (`/orcamento`). */
export const PANEL_SECTIONS = [
  'painel',
  'motoristas',
  'comerciantes',
  'acolhida',
  'assembleias',
  'compra-coletiva',
  'denuncias',
  'usuarios',
  'auditoria',
  'orcamento',
  'simulador',
] as const;
export type PanelSection = (typeof PANEL_SECTIONS)[number];

/** Quem pode abrir cada área. Sócio: só transparência (assembleias, fila da compra e orçamento). */
export const SECTION_ACCESS: Record<PanelSection, readonly PanelRole[]> = {
  painel: ['ADMIN', 'SOCIO'],
  motoristas: ['ADMIN'],
  comerciantes: ['ADMIN'],
  acolhida: ['ADMIN'],
  assembleias: ['ADMIN', 'SOCIO'],
  'compra-coletiva': ['ADMIN', 'SOCIO'],
  denuncias: ['ADMIN'],
  usuarios: ['ADMIN'],
  auditoria: ['ADMIN'],
  orcamento: ['ADMIN', 'SOCIO'],
  simulador: ['ADMIN'],
};

export const SECTION_LABEL: Record<PanelSection, string> = {
  painel: 'Painel',
  motoristas: 'Motoristas',
  comerciantes: 'Comerciantes',
  acolhida: 'Pontos de acolhida',
  assembleias: 'Assembleias',
  'compra-coletiva': 'Compra coletiva',
  denuncias: 'Denúncias e alertas',
  usuarios: 'Bloqueios e recursos',
  auditoria: 'Auditoria',
  orcamento: 'Orçamento aberto',
  simulador: 'Simulador (teste)',
};

/** Papéis de painel de uma pessoa. Sócio = motorista com cotas; um admin que também é sócio tem os dois. */
export function panelRolesFor(userRoles: readonly string[], member: boolean): PanelRole[] {
  const out: PanelRole[] = [];
  if (userRoles.includes('ADMIN')) out.push('ADMIN');
  if (userRoles.includes('MOTORISTA') && member) out.push('SOCIO');
  return out;
}

export function canAccessSection(roles: readonly PanelRole[], section: PanelSection): boolean {
  return SECTION_ACCESS[section].some((r) => roles.includes(r));
}

export function sectionsFor(roles: readonly PanelRole[]): PanelSection[] {
  return PANEL_SECTIONS.filter((s) => canAccessSection(roles, s));
}

/** Primeiro trecho da rota -> área; null se não for uma área conhecida. */
export function sectionOfPath(pathname: string): PanelSection | null {
  const first = pathname.split('/').filter(Boolean)[0] ?? 'painel';
  return (PANEL_SECTIONS as readonly string[]).includes(first) ? (first as PanelSection) : null;
}
