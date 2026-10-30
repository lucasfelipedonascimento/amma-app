import type { DeliveryStatus } from './delivery-state';

/**
 * Corrida de passageiro e entrega usam o MESMO pedido (`Delivery`), a mesma máquina de estados,
 * o mesmo despacho, pagamento e ledger. O que muda é o `kind` e os campos extras da corrida.
 *
 * Mapeamento dos estados para a corrida:
 *   ACEITO / A_CAMINHO_COLETA → motorista indo buscar o passageiro
 *   COLETADO                  → passageiro embarcou (exige o PIN de embarque)
 *   A_CAMINHO_ENTREGA         → em viagem
 *   ENTREGUE                  → viagem concluída
 */
export const DELIVERY_KINDS = ['ENTREGA', 'CORRIDA'] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

export const RIDE_VEHICLE_TYPES = ['CARRO', 'MOTO'] as const;
export type RideVehicleType = (typeof RIDE_VEHICLE_TYPES)[number];

export const RIDE_VEHICLE_LABEL: Record<RideVehicleType, string> = {
  CARRO: 'Carro',
  MOTO: 'Moto',
};

/** Cada perfil tem a sua tabela de preço versionada. Entrega é o perfil original. */
export const PRICING_PROFILES = ['ENTREGA', 'CORRIDA_CARRO', 'CORRIDA_MOTO'] as const;
export type PricingProfile = (typeof PRICING_PROFILES)[number];

export function pricingProfile(
  kind: DeliveryKind,
  vehicleType?: RideVehicleType | null,
): PricingProfile {
  if (kind === 'ENTREGA') return 'ENTREGA';
  return vehicleType === 'MOTO' ? 'CORRIDA_MOTO' : 'CORRIDA_CARRO';
}

// ---------- Textos por tipo de pedido (o mesmo estado se lê diferente numa corrida) ----------

const RIDE_STATUS_LABEL: Record<DeliveryStatus, string> = {
  CRIADO: 'Buscando motorista',
  OFERECIDO: 'Buscando motorista',
  ACEITO: 'Motorista confirmado',
  A_CAMINHO_COLETA: 'Motorista a caminho de você',
  COLETADO: 'Você embarcou',
  A_CAMINHO_ENTREGA: 'Em viagem',
  ENTREGUE: 'Viagem concluída',
  CANCELADO: 'Corrida cancelada',
};

const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  CRIADO: 'Buscando motorista',
  OFERECIDO: 'Buscando motorista',
  ACEITO: 'Motorista confirmado',
  A_CAMINHO_COLETA: 'Motorista indo à coleta',
  COLETADO: 'Item coletado',
  A_CAMINHO_ENTREGA: 'A caminho da entrega',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

export const statusLabel = (kind: DeliveryKind, status: DeliveryStatus): string =>
  (kind === 'CORRIDA' ? RIDE_STATUS_LABEL : DELIVERY_STATUS_LABEL)[status];

// ---------- PIN de embarque ----------

export const BOARDING_PIN_LENGTH = 4;
/** Tentativas erradas (e certas) do motorista antes de travar o embarque. */
export const BOARDING_PIN_MAX_ATTEMPTS = 5;

/** `random` devolve um inteiro em [0, max): em produção, `crypto.randomInt`. */
export function generateBoardingPin(random: (max: number) => number): string {
  return String(random(10 ** BOARDING_PIN_LENGTH)).padStart(BOARDING_PIN_LENGTH, '0');
}

export const isValidBoardingPin = (pin: unknown): pin is string =>
  typeof pin === 'string' && new RegExp(`^\\d{${BOARDING_PIN_LENGTH}}$`).test(pin);

/** O PIN só tem utilidade até o passageiro embarcar; depois disso some da tela. */
export const boardingPinVisible = (status: DeliveryStatus): boolean =>
  status === 'CRIADO' ||
  status === 'OFERECIDO' ||
  status === 'ACEITO' ||
  status === 'A_CAMINHO_COLETA';

// ---------- Viagem compartilhada com um contato ----------

/** Depois que a viagem termina, o link continua abrindo por este tempo (o contato vê que chegou bem). */
export const SHARE_GRACE_MINUTES = 30;
export const SHARE_MAX_ACTIVE_PER_RIDE = 5;

export interface ShareState {
  revoked: boolean;
  status: DeliveryStatus;
  /** Quando a corrida terminou (ENTREGUE ou CANCELADO), se terminou. */
  endedAt: Date | null;
}

export function shareIsOpen(s: ShareState, now: Date): boolean {
  if (s.revoked) return false;
  if (!s.endedAt) return true;
  return now.getTime() - s.endedAt.getTime() <= SHARE_GRACE_MINUTES * 60_000;
}

/** Só se compartilha uma corrida com motorista definido e ainda não terminada. */
export const canShareRide = (status: DeliveryStatus): boolean =>
  status === 'ACEITO' ||
  status === 'A_CAMINHO_COLETA' ||
  status === 'COLETADO' ||
  status === 'A_CAMINHO_ENTREGA';

/** Primeiro nome: é o que o contato e a outra parte da corrida veem (minimização, LGPD). */
export function firstName(name: string | null | undefined): string | null {
  const n = name?.trim().split(/\s+/)[0];
  return n ? n : null;
}
