/**
 * Trilha de auditoria: toda ação de um admin que muda algo (e a abertura de dado sensível) fica registrada,
 * só de inserção. Aqui ficam os textos em português e a regra de quais rotas entram.
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'POST /admin/documents/:id/review': 'Revisou documento de motorista',
  'GET /admin/documents/:id/file': 'Abriu arquivo de documento',
  'POST /admin/drivers/:id/gender-verification': 'Conferiu autodeclaração de gênero',
  'POST /admin/merchants/:id/review': 'Revisou cadastro de comerciante',
  'POST /admin/welcome-points/:id/approve': 'Aprovou ponto de acolhida',
  'POST /admin/welcome-points/:id/refuse': 'Recusou ponto de acolhida',
  'POST /admin/welcome-points/:id/remove': 'Removeu ponto de acolhida',
  'POST /admin/welcome-points/:id/reinstate': 'Reativou ponto de acolhida',
  'POST /admin/welcome-reports/:id/resolve': 'Resolveu denúncia de ponto',
  'PATCH /admin/safety/reports/:id': 'Tratou denúncia',
  'PATCH /admin/safety/alerts/:id': 'Tratou alerta de emergência',
  'GET /admin/rides/:id/trip-record': 'Abriu registro de viagem',
  'POST /admin/municipal-rules': 'Publicou regras municipais',
  'POST /admin/assembly/proposals': 'Abriu proposta de assembleia',
  'POST /admin/purchase-groups': 'Criou grupo de compra coletiva',
  'POST /admin/purchase-groups/:id/award': 'Contemplou na compra coletiva',
  'POST /admin/purchase-groups/:id/close': 'Encerrou grupo de compra coletiva',
  'POST /admin/insurance/claims/:id/review': 'Pôs pedido de seguro em análise',
  'POST /admin/insurance/claims/:id/decision': 'Decidiu pedido de seguro',
  'GET /admin/insurance/claims/:id/attachments/:attachmentId': 'Abriu anexo de seguro',
  'POST /admin/surplus/close': 'Fechou as sobras do ano',
  'PUT /admin/dispatch-settings': 'Alterou parâmetros do despacho',
  'POST /admin/pricing': 'Publicou tabela de preços',
  'POST /admin/deliveries/:id/refund': 'Estornou pedido',
  'POST /admin/users/:id/block': 'Bloqueou conta',
  'POST /admin/blocks/:id/revoke': 'Revogou bloqueio',
  'POST /admin/blocks/:id/appeal-decision': 'Decidiu recurso de bloqueio',
  'POST /admin/budget/entries': 'Lançou no orçamento',
  'POST /admin/budget/entries/:id/reverse': 'Estornou lançamento do orçamento',
};

export const auditLabel = (action: string): string => AUDIT_ACTION_LABEL[action] ?? action;

/** Leituras de dado sensível também entram na trilha; as demais GET (listas, painéis) não. */
const SENSITIVE_READS = new Set(
  Object.keys(AUDIT_ACTION_LABEL).filter((k) => k.startsWith('GET ')),
);

export function shouldAudit(method: string, routePattern: string): boolean {
  const action = `${method.toUpperCase()} ${routePattern}`;
  if (method.toUpperCase() === 'GET') return SENSITIVE_READS.has(action);
  return true;
}

/** Ação normalizada: método + rota com parâmetros (`/admin/documents/:id/review`). */
export const auditAction = (method: string, routePattern: string): string =>
  `${method.toUpperCase()} ${routePattern}`;
