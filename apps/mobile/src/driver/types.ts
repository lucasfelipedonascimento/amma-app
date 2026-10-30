import type { AssociationRate, DaySummary, DeliveryStatus, EarningsTotals } from '@amma/shared';

export interface Coords {
  lat: number;
  lng: number;
}

export interface Place extends Coords {
  address: string;
}

/** Oferta como a API entrega (REST e WebSocket `offer.created`). */
export interface Offer {
  id: string;
  deliveryId: string;
  expiresAt: string;
  distanceToPickupMeters: number;
  pickupEtaSeconds: number | null;
  pickup: Place;
  dropoff: Place;
  notes: string | null;
  deliveryDistanceMeters: number;
  deliveryDurationSeconds: number;
  fareCents: number;
  estimatedNetCents: number;
}

/** Pedido em andamento, visto pelo motorista. */
export interface ActiveDelivery {
  id: string;
  status: DeliveryStatus;
  pickup: Place;
  dropoff: Place;
  notes: string | null;
  distanceMeters: number;
  durationSeconds: number;
  fareCents: number;
}

export interface RouteInfo {
  target: 'COLETA' | 'ENTREGA';
  destination: Place;
  distanceMeters: number;
  durationSeconds: number;
  path: Coords[];
}

export interface Comparison {
  competitorFeeCents: number;
  competitorNetCents: number;
  extraCents: number;
}

export interface HistoryItem {
  id: string;
  deliveredAt: string;
  pickupAddress: string;
  dropoffAddress: string;
  fareCents: number;
  platformFeeCents: number;
  associationFeeCents: number;
  workerNetCents: number;
  associationRate: number;
}

export interface Earnings {
  associationRate: AssociationRate;
  today: EarningsTotals & Comparison;
  week: { days: DaySummary[] } & EarningsTotals & Comparison;
  history: HistoryItem[];
}

export interface Presence {
  online: boolean;
  onlineSince: string | null;
  position: (Coords & { at: string }) | null;
}

export interface LocationConsent {
  version: string;
  granted: boolean;
}
