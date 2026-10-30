import type {
  CancelReason,
  DeliveryKind,
  DeliveryStatus,
  PaymentMethod,
  PaymentStatus,
  RatingSummary,
  RideVehicleType,
} from '@amma/shared';
import type { Coords, Place } from '../driver/types';

export type { Coords, Place };

export interface PaymentInfo {
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  /** Só enquanto o Pix está pendente. */
  pixCode: string | null;
  pixExpiresAt: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  /** true = provedor de testes: nada é cobrado de verdade. */
  sandbox: boolean;
}

/** Pedido como o cliente o vê (`GET /deliveries` e `/deliveries/:id`). */
export interface ClientDelivery {
  id: string;
  /** Ausente em pedidos antigos = ENTREGA. */
  kind?: DeliveryKind;
  status: DeliveryStatus;
  vehicleType?: RideVehicleType | null;
  womenDriverOnly?: boolean;
  /** Corrida: o passageiro mostra ao motorista para confirmar o embarque; some depois. */
  boardingPin?: string | null;
  /** Corrida: o veículo que atendeu, para conferir a placa. */
  vehicle?: { type: RideVehicleType; plate: string; model: string; year: number } | null;
  driverRating?: RatingSummary | null;
  pickup: Place;
  dropoff: Place;
  notes: string | null;
  distanceMeters: number;
  durationSeconds: number;
  fareCents: number;
  minimumApplied: boolean;
  cancelReason: CancelReason | null;
  createdAt: string;
  deliveredAt: string | null;
  driver: { id: string; name: string | null } | null;
  payment: PaymentInfo | null;
  rating: { stars: number; comment: string | null; at: string } | null;
  /** Só no detalhe. */
  driverPosition?: (Coords & { at?: string }) | null;
}

export interface Quote {
  distanceMeters: number;
  durationSeconds: number;
  fareCents: number;
  minimumApplied: boolean;
  pricingVersion: string;
}

export interface PaymentConfig {
  provider: string;
  sandbox: boolean;
  methods: ('PIX' | 'CARTAO')[];
}

export interface MerchantProfile {
  tradeName: string;
  cnpj: string | null;
  address: string;
  lat: number;
  lng: number;
}

export interface RideOption {
  vehicleType: RideVehicleType;
  label: string;
  /** false = sem tabela de preço para este tipo no momento. */
  available: boolean;
  fareCents: number | null;
  minimumApplied: boolean;
  driversNearby: number;
  /** Quanto o motorista mais próximo leva para chegar; null = ninguém por perto. */
  pickupEtaSeconds: number | null;
  notices: string[];
}

export interface RideQuote {
  distanceMeters: number;
  durationSeconds: number;
  womenDriverOnly: boolean;
  options: RideOption[];
}

export interface RideRules {
  city: string;
  womenDriverOptionEnabled: boolean;
  vehicleTypes: { type: RideVehicleType; label: string; enabled: boolean; notices: string[] }[];
}

export interface TripShare {
  id: string;
  token: string;
  url: string;
}
