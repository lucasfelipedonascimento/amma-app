import {
  boardingPinVisible,
  calculateRideFees,
  firstName,
  type AssociationRate,
  type RatingSummary,
} from '@amma/shared';
import type { Delivery, DeliveryOffer, Payment, Rating, Vehicle } from '@prisma/client';
import { paymentView } from '../payments/payments.service';
import type { PaymentProvider } from '../payments/payment-provider';

export type Viewer = 'CLIENTE' | 'MOTORISTA' | 'ADMIN';

/** O que cada papel enxerga de um pedido. Contato/telefone nunca sai daqui (minimização, LGPD). */
/** Dados extras de corrida de passageiro: reputação de cada parte, calculada por quem monta a resposta. */
export interface RideExtras {
  driverRating?: RatingSummary;
  passengerRating?: RatingSummary;
  client?: { name: string | null };
}

export function deliveryView(
  d: Delivery & {
    worker?: { name: string | null } | null;
    payment?: Payment | null;
    ratings?: Rating[];
    vehicle?: Vehicle | null;
  },
  viewer: Viewer,
  provider?: PaymentProvider,
  extras: RideExtras = {},
) {
  const settled = d.status === 'ENTREGUE';
  const isRide = d.kind === 'CORRIDA';
  // Cada parte vê a nota que ELA deu; o admin vê as duas. Quem recebeu nunca vê nota nem comentário.
  const given = d.ratings?.find((r) =>
    viewer === 'MOTORISTA'
      ? r.direction === 'MOTORISTA_AVALIA_CLIENTE'
      : r.direction === 'CLIENTE_AVALIA_MOTORISTA',
  );
  const passengerGiven = d.ratings?.find((r) => r.direction === 'MOTORISTA_AVALIA_CLIENTE');
  const ratingOut = (r?: Rating) =>
    r ? { stars: r.stars, comment: r.comment, at: r.createdAt } : null;
  return {
    id: d.id,
    kind: d.kind,
    status: d.status,
    vehicleType: d.vehicleType,
    womenDriverOnly: d.womenDriverOnly,
    // O PIN é do passageiro: o motorista precisa ouvi-lo, nunca lê-lo na tela.
    boardingPin:
      isRide && viewer === 'CLIENTE' && boardingPinVisible(d.status) ? d.boardingPin : null,
    // Para o passageiro conferir quem chegou (nome, placa e modelo) antes de embarcar.
    vehicle:
      isRide && viewer !== 'MOTORISTA' && d.vehicle
        ? {
            type: d.vehicle.type,
            plate: d.vehicle.plate,
            model: d.vehicle.model,
            year: d.vehicle.year,
          }
        : null,
    driverRating: isRide && viewer !== 'MOTORISTA' ? (extras.driverRating ?? null) : null,
    passenger:
      isRide && viewer === 'MOTORISTA'
        ? {
            firstName: firstName(extras.client?.name),
            rating: extras.passengerRating ?? null,
          }
        : null,
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
    rating: ratingOut(given),
    passengerRating: viewer === 'ADMIN' ? ratingOut(passengerGiven) : undefined,
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
export function offerView(
  o: DeliveryOffer,
  d: Delivery,
  associationRate: number,
  passenger: { firstName: string | null; rating: RatingSummary } | null = null,
) {
  const fees = calculateRideFees(d.fareCents, associationRate as AssociationRate);
  return {
    id: o.id,
    deliveryId: d.id,
    kind: d.kind,
    vehicleType: d.vehicleType,
    womenDriverOnly: d.womenDriverOnly,
    passenger,
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
