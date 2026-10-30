import type {
  AssociationRate,
  DaySummary,
  DeliveryKind,
  DeliveryStatus,
  EarningsTotals,
  EligibilityProblem,
  Gender,
  RatingSummary,
  RideVehicleType,
} from '@amma/shared';

export interface Coords {
  lat: number;
  lng: number;
}

export interface Place extends Coords {
  address: string;
}

/** Oferta como a API entrega (REST e WebSocket `offer.created`). */
export interface Passenger {
  firstName: string | null;
  rating: RatingSummary | null;
}

export interface Offer {
  id: string;
  deliveryId: string;
  /** Ausente em ofertas antigas = ENTREGA. */
  kind?: DeliveryKind;
  vehicleType?: RideVehicleType | null;
  womenDriverOnly?: boolean;
  passenger?: Passenger | null;
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
  kind?: DeliveryKind;
  status: DeliveryStatus;
  passenger?: Passenger | null;
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

/** Habilitação do motorista para corridas de passageiro (`GET /driver/ride-eligibility`). */
export interface RideEligibility {
  rulesVersion: string;
  rulesAreDefault: boolean;
  warning: string | null;
  gender: Gender | null;
  womenDriverVerified: boolean;
  vehicles: {
    id: string;
    plate: string;
    model: string;
    year: number;
    type: RideVehicleType;
    eligible: boolean;
    problems: EligibilityProblem[];
    documentsToSend: string[];
  }[];
}
