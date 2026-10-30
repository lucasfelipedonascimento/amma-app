import { ReactNode } from 'react';
import { ClientContext, type ClientValue } from '../client/ClientProvider';
import type { ClientDelivery, PaymentInfo } from '../client/types';

export const payment: PaymentInfo = {
  method: 'CARTAO',
  status: 'PAGO',
  amountCents: 1100,
  pixCode: null,
  pixExpiresAt: null,
  cardBrand: 'visa',
  cardLast4: '4242',
  paidAt: '2026-10-29T18:00:05Z',
  refundedAt: null,
  sandbox: true,
};

export const delivery: ClientDelivery = {
  id: 'd1',
  status: 'OFERECIDO',
  pickup: { lat: -7.115, lng: -34.861, address: 'Rua da Coleta, 100' },
  dropoff: { lat: -7.095, lng: -34.861, address: 'Rua da Entrega, 200' },
  notes: 'Marmita',
  distanceMeters: 2894,
  durationSeconds: 417,
  fareCents: 1100,
  minimumApplied: true,
  cancelReason: null,
  createdAt: '2026-10-29T18:00:00Z',
  deliveredAt: null,
  driver: null,
  payment,
  rating: null,
};

export const pixPayment: PaymentInfo = {
  ...payment,
  method: 'PIX',
  status: 'PENDENTE',
  pixCode: 'PIX-SIMULADO|pix_sbx_abc|1100',
  pixExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  cardBrand: null,
  cardLast4: null,
  paidAt: null,
};

export function clientValue(over: Partial<ClientValue> = {}): ClientValue {
  return {
    isMerchant: false,
    realtime: 'closed',
    offline: false,
    subscribe: jest.fn(() => jest.fn()),
    deliveries: [],
    deliveriesError: null,
    reloadDeliveries: jest.fn(async () => undefined),
    merchant: null,
    setMerchant: jest.fn(),
    paymentConfig: { provider: 'sandbox', sandbox: true, methods: ['PIX', 'CARTAO'] },
    ...over,
  };
}

export function WithClient({ value, children }: { value: ClientValue; children: ReactNode }) {
  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}
