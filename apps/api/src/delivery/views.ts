import { calculateRideFees, type AssociationRate } from '@amma/shared';
import type { Delivery, DeliveryOffer, Payment, Rating } from '@prisma/client';
import { paymentView } from '../payments/payments.service';
import type { PaymentProvider } from '../payments/payment-provider';

export type Viewer = 'CLIENTE' | 'MOTORISTA' | 'ADMIN';

/** O que cada papel enxerga de um pedido. Contato/telefone nunca sai daqui (minimização, LGPD). */
export function deliveryView(
  d: Delivery & {
    worker?: { name: string | null } | null;
    payment?: Payment | null;
    rating?: Rating | null;
  },
  viewer: Viewer,
  provider?: PaymentProvider,
) {
  const settled = d.status === 'ENTREGUE';
  return {
    id: d.id,
    status: d.status,
    pickup: { lat: d.pickupLat, lng: d.pickupLng, address: d.pickupAddress },
    dropoff: { lat: d.dropoffLat, lng: d.dropoffLng, address: d.dropoffAddress },
    notes: d.notes,
    distanceMeters: d.distanceMeters,
    durationSeconds: d.durationSeconds,
    fareCents: d.fareCents,
    minimumApplied: d.minimumApplied,
    pricingVersion: d.pricingVersion,
    cancelReason: d.cancelReason,
    cancelNote: viewer === 'MOTORISTA' ? null : d.cancelNote,
    createdAt: d.createdAt,
    acceptedAt: d.acceptedAt,
    pickedUpAt: d.pickedUpAt,
    deliveredAt: d.deliveredAt,
    driver:
      viewer === 'MOTORISTA' || !d.workerId
        ? null
        : { id: d.workerId, name: d.worker?.name ?? null },
    // Pagamento e avaliação são do cliente (e do admin); o motorista não vê.
    payment:
      viewer !== 'MOTORISTA' && d.payment && provider ? paymentView(d.payment, provider) : null,
    rating:
      viewer !== 'MOTORISTA' && d.rating
        ? { stars: d.rating.stars, comment: d.rating.comment, at: d.rating.createdAt }
        : null,
    // Repasse mostrado ao motorista e ao admin; o cliente só vê o valor do pedido.
    settlement:
      settled && viewer !== 'CLIENTE'
        ? {
            platformFeeCents: d.platformFeeCents,
            associationFeeCents: d.associationFeeCents,
            workerNetCents: d.workerNetCents,
            associationRate: d.associationRate,
          }
        : null,
  };
}

/** Oferta como o motorista a vê, com a estimativa do que ele recebe (taxas públicas). */
export function offerView(o: DeliveryOffer, d: Delivery, associationRate: number) {
  const fees = calculateRideFees(d.fareCents, associationRate as AssociationRate);
  return {
    id: o.id,
    deliveryId: d.id,
    expiresAt: o.expiresAt,
    distanceToPickupMeters: o.distanceMeters,
    pickupEtaSeconds: o.pickupEtaSeconds,
    pickup: { lat: d.pickupLat, lng: d.pickupLng, address: d.pickupAddress },
    dropoff: { lat: d.dropoffLat, lng: d.dropoffLng, address: d.dropoffAddress },
    notes: d.notes,
    deliveryDistanceMeters: d.distanceMeters,
    deliveryDurationSeconds: d.durationSeconds,
    fareCents: d.fareCents,
    estimatedNetCents: fees.workerNetCents,
  };
}
