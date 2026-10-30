import type { CancelReason, DeliveryStatus, PaymentMethod, PaymentStatus } from '@amma/shared';
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
  status: DeliveryStatus;
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
