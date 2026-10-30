/**
 * Estados do pedido de entrega.
 *
 *   CRIADO ──► OFERECIDO ──► ACEITO ──► A_CAMINHO_COLETA ──► COLETADO ──► A_CAMINHO_ENTREGA ──► ENTREGUE
 *     ▲            │            │              │
 *     └────────────┴────────────┴──────────────┘   recusa/expiração da oferta ou desistência do motorista
 *
 * CANCELADO é alcançável de qualquer estado não terminal, mas só pelos motivos/atores de CANCEL_RULES.
 */
export const DELIVERY_STATUSES = [
  'CRIADO',
  'OFERECIDO',
  'ACEITO',
  'A_CAMINHO_COLETA',
  'COLETADO',
  'A_CAMINHO_ENTREGA',
  'ENTREGUE',
  'CANCELADO',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

const TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  CRIADO: ['OFERECIDO', 'CANCELADO'],
  OFERECIDO: ['ACEITO', 'CRIADO', 'CANCELADO'],
  ACEITO: ['A_CAMINHO_COLETA', 'CRIADO', 'CANCELADO'],
  A_CAMINHO_COLETA: ['COLETADO', 'CRIADO', 'CANCELADO'],
  COLETADO: ['A_CAMINHO_ENTREGA', 'CANCELADO'],
  A_CAMINHO_ENTREGA: ['ENTREGUE', 'CANCELADO'],
  ENTREGUE: [],
  CANCELADO: [],
};

export const canTransitionDelivery = (from: DeliveryStatus, to: DeliveryStatus): boolean =>
  TRANSITIONS[from].includes(to);

export const isTerminalDelivery = (s: DeliveryStatus): boolean => TRANSITIONS[s].length === 0;

export function transitionDelivery(from: DeliveryStatus, to: DeliveryStatus): DeliveryStatus {
  if (!canTransitionDelivery(from, to)) throw new Error(`Transição inválida: ${from} -> ${to}`);
  return to;
}

/** Estados em que há um motorista responsável pela entrega. */
export const ACTIVE_DRIVER_STATUSES = [
  'ACEITO',
  'A_CAMINHO_COLETA',
  'COLETADO',
  'A_CAMINHO_ENTREGA',
] as const satisfies readonly DeliveryStatus[];

export const hasAssignedDriver = (s: DeliveryStatus): boolean =>
  (ACTIVE_DRIVER_STATUSES as readonly string[]).includes(s);

// ---------- Cancelamento ----------

export const CANCEL_REASONS = [
  'CLIENTE_DESISTIU',
  'SEM_MOTORISTA',
  'COLETA_IMPOSSIVEL',
  'ENTREGA_IMPOSSIVEL',
  'ADMIN_CANCELOU',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const CANCEL_ACTORS = ['CLIENTE', 'MOTORISTA', 'SISTEMA', 'ADMIN'] as const;
export type CancelActor = (typeof CANCEL_ACTORS)[number];

export interface CancelRule {
  actor: CancelActor;
  from: readonly DeliveryStatus[];
  description: string;
}

/** Quem pode cancelar, por qual motivo e em que estados. */
export const CANCEL_RULES: Record<CancelReason, CancelRule> = {
  CLIENTE_DESISTIU: {
    actor: 'CLIENTE',
    from: ['CRIADO', 'OFERECIDO', 'ACEITO', 'A_CAMINHO_COLETA'],
    description: 'O cliente desistiu antes de o item ser coletado.',
  },
  SEM_MOTORISTA: {
    actor: 'SISTEMA',
    from: ['CRIADO'],
    description: 'Nenhum motorista aceitou dentro do tempo máximo de busca.',
  },
  COLETA_IMPOSSIVEL: {
    actor: 'MOTORISTA',
    from: ['A_CAMINHO_COLETA'],
    description: 'O motorista não conseguiu coletar o item (ex.: não estava pronto).',
  },
  ENTREGA_IMPOSSIVEL: {
    actor: 'MOTORISTA',
    from: ['COLETADO', 'A_CAMINHO_ENTREGA'],
    description: 'O motorista não conseguiu entregar (ex.: destinatário ausente).',
  },
  ADMIN_CANCELOU: {
    actor: 'ADMIN',
    from: ['CRIADO', 'OFERECIDO', 'ACEITO', 'A_CAMINHO_COLETA', 'COLETADO', 'A_CAMINHO_ENTREGA'],
    description: 'Cancelamento administrativo (precisa de justificativa).',
  },
};

export const canCancel = (
  status: DeliveryStatus,
  reason: CancelReason,
  actor: CancelActor,
): boolean => CANCEL_RULES[reason].actor === actor && CANCEL_RULES[reason].from.includes(status);
