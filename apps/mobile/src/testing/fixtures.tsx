import { ReactNode } from 'react';
import { DriverContext, DriverValue } from '../driver/DriverProvider';
import type { ActiveDelivery, Earnings, Offer } from '../driver/types';

export const offer: Offer = {
  id: 'o1',
  deliveryId: 'd1',
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  distanceToPickupMeters: 312,
  pickupEtaSeconds: 58,
  pickup: { lat: -7.115, lng: -34.861, address: 'Rua da Coleta, 100' },
  dropoff: { lat: -7.095, lng: -34.861, address: 'Rua da Entrega, 200' },
  notes: null,
  deliveryDistanceMeters: 2894,
  deliveryDurationSeconds: 417,
  fareCents: 1100,
  estimatedNetCents: 968,
};

export const active: ActiveDelivery = {
  id: 'd1',
  status: 'ACEITO',
  pickup: offer.pickup,
  dropoff: offer.dropoff,
  notes: null,
  distanceMeters: 2894,
  durationSeconds: 417,
  fareCents: 1100,
};

const comparison = { competitorFeeCents: 275, competitorNetCents: 825, extraCents: 143 };
const totals = {
  deliveries: 1,
  grossCents: 1100,
  platformFeeCents: 110,
  associationFeeCents: 22,
  netCents: 968,
};

export const earnings: Earnings = {
  associationRate: 2,
  today: { ...totals, ...comparison },
  week: {
    ...totals,
    ...comparison,
    days: [
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
    ].map((date, i) => ({
      date,
      ...(i === 6
        ? totals
        : {
            ...totals,
            deliveries: 0,
            grossCents: 0,
            netCents: 0,
            platformFeeCents: 0,
            associationFeeCents: 0,
          }),
    })),
  },
  history: [
    {
      id: 'h1',
      deliveredAt: '2026-10-29T18:30:00Z',
      pickupAddress: 'Rua A',
      dropoffAddress: 'Rua B',
      fareCents: 1100,
      platformFeeCents: 110,
      associationFeeCents: 22,
      workerNetCents: 968,
      associationRate: 2,
    },
  ],
};

export function driverValue(over: Partial<DriverValue> = {}): DriverValue {
  const fn = () => jest.fn(async () => undefined);
  return {
    ready: true,
    loadError: null,
    reload: fn(),
    online: false,
    busy: false,
    actionError: null,
    clearError: jest.fn(),
    position: null,
    offer: null,
    active: null,
    completed: null,
    dismissCompleted: jest.fn(),
    earnings,
    earningsError: null,
    refreshEarnings: fn(),
    realtime: 'closed',
    offline: false,
    access: 'background',
    consented: true,
    consentOpen: false,
    closeConsent: jest.fn(),
    openSettings: jest.fn(),
    pushNote: null,
    goOnline: fn(),
    goOffline: fn(),
    acceptConsent: fn(),
    revokeConsent: fn(),
    accept: fn(),
    decline: fn(),
    advance: fn(),
    release: fn(),
    prepareSignOut: fn(),
    ...over,
  };
}

export function WithDriver({ value, children }: { value: DriverValue; children: ReactNode }) {
  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
}

/** Texto sem espaço "duro" que o Intl coloca em "R$ 9,68". */
export const plain = (s: string) => s.replace(/ /g, ' ');
