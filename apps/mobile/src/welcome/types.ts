import type {
  Amenity,
  HostBenefitKind,
  OpeningHours,
  PointReportCategory,
  PointReportStatus,
  PointStatus,
  PointType,
} from '@amma/shared';

export interface Rating {
  average: number | null;
  count: number;
}

/** Um ponto como a API devolve. Os campos de `status` em diante só vêm para o dono e o admin. */
export interface WelcomePointView {
  id: string;
  type: PointType;
  name: string;
  description: string | null;
  neighborhood: string;
  address: string | null;
  reference: string | null;
  lat: number;
  lng: number;
  approximate: boolean;
  hours: OpeningHours;
  openNow: boolean;
  amenities: Amenity[];
  capacity: number;
  occupied: number;
  photos: string[];
  rating: Rating;
  hasHost: boolean;
  isOwner: boolean;
  distanceMeters?: number;
  status?: PointStatus;
  statusNote?: string | null;
  benefitKind?: HostBenefitKind;
}

export interface CheckInView {
  id: string;
  pointId: string;
  startedAt: string;
  endedAt: string | null;
  completed: boolean;
  expiresAt: string;
  minMinutes: number;
}

export interface ActiveCheckIn {
  checkIn: CheckInView | null;
  point: WelcomePointView | null;
}

export interface HistoryItem extends CheckInView {
  point: { id: string; name: string; type: PointType; neighborhood: string };
  rated: boolean;
  canRate: boolean;
}

export interface VisitItem {
  id: string;
  endedAt: string;
  minutes: number;
  visitorName: string;
  visitorRating: Rating;
  rated: boolean;
  canRate: boolean;
}

export interface MyReport {
  id: string;
  pointId: string;
  pointName: string;
  category: PointReportCategory;
  status: PointReportStatus;
  response: string | null;
  createdAt: string;
}

export interface Position {
  lat: number;
  lng: number;
}
