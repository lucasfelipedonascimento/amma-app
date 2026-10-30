import type { CancelReason, DeliveryStatus, PaymentMethod, PaymentStatus } from '@amma/shared';
import type { ClientDelivery } from './types';

export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  CRIADO: 'Buscando motorista',
  OFERECIDO: 'Buscando motorista',
  ACEITO: 'Motorista confirmado',
  A_CAMINHO_COLETA: 'Motorista indo à coleta',
  COLETADO: 'Item coletado',
  A_CAMINHO_ENTREGA: 'A caminho da entrega',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

export const CANCEL_LABEL: Record<CancelReason, string> = {
  CLIENTE_DESISTIU: 'Você cancelou o pedido.',
  SEM_MOTORISTA: 'Nenhum motorista aceitou a tempo.',
  COLETA_IMPOSSIVEL: 'O motorista não conseguiu coletar o item.',
  ENTREGA_IMPOSSIVEL: 'O motorista não conseguiu entregar o item.',
  ADMIN_CANCELOU: 'A associação cancelou o pedido.',
  PAGAMENTO_NAO_CONFIRMADO: 'O Pix não foi pago a tempo.',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDENTE: 'Aguardando pagamento',
  PAGO: 'Pago',
  EXPIRADO: 'Não pago',
  ESTORNADO: 'Estornado',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = { PIX: 'Pix', CARTAO: 'Cartão' };

/** Texto do estado do pedido; com Pix ainda pendente, o que importa é o pagamento. */
export function statusText(d: Pick<ClientDelivery, 'status' | 'payment'>): string {
  if (d.status === 'CRIADO' && d.payment?.status === 'PENDENTE') return 'Aguardando o pagamento';
  return STATUS_LABEL[d.status];
}

export const isOpen = (s: DeliveryStatus) => s !== 'ENTREGUE' && s !== 'CANCELADO';

/** O cliente pode desistir até o motorista coletar o item (mesma regra do servidor: CANCEL_RULES). */
export const canClientCancel = (s: DeliveryStatus) =>
  s === 'CRIADO' || s === 'OFERECIDO' || s === 'ACEITO' || s === 'A_CAMINHO_COLETA';

export const CLIENT_STAGES = [
  'Pagamento e busca',
  'Indo à coleta',
  'A caminho',
  'Entregue',
] as const;

/** Quantas etapas já foram concluídas (0 a 4), para a barra de progresso do cliente. */
export function clientStage(d: Pick<ClientDelivery, 'status' | 'payment'>): number {
  switch (d.status) {
    case 'ACEITO':
    case 'A_CAMINHO_COLETA':
      return 1;
    case 'COLETADO':
    case 'A_CAMINHO_ENTREGA':
      return 2;
    case 'ENTREGUE':
      return 4;
    default:
      return 0;
  }
}

/** Segundos até o Pix vencer (nunca negativo). */
export function secondsLeft(iso: string | null, now = Date.now()): number {
  return iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : 0;
}

export const formatClock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
