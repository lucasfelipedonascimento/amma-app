import { canTransitionDelivery, type CancelReason, type DeliveryStatus } from '@amma/shared';
import { DeliveryEventType, Prisma } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface EventInput {
  deliveryId: string;
  type: DeliveryEventType;
  fromStatus?: DeliveryStatus;
  toStatus?: DeliveryStatus;
  actorId?: string | null;
  reason?: string;
  data?: Prisma.InputJsonValue;
}

export const recordEvent = (tx: Tx, e: EventInput) =>
  tx.deliveryEvent.create({
    data: {
      deliveryId: e.deliveryId,
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorId: e.actorId ?? null,
      reason: e.reason,
      data: e.data,
    },
  });

/**
 * Muda o estado só se o pedido AINDA estiver em `from` (compare-and-set). Duas requisições
 * concorrentes nunca aplicam a mesma transição duas vezes. Grava o evento STATUS.
 * Retorna false se outro processo chegou primeiro.
 */
export async function moveStatus(
  tx: Tx,
  input: {
    id: string;
    from: DeliveryStatus;
    to: DeliveryStatus;
    /** Condição extra (ex.: workerId do motorista que está agindo). */
    where?: Prisma.DeliveryWhereInput;
    data?: Prisma.DeliveryUncheckedUpdateManyInput;
    actorId?: string | null;
    reason?: string;
    eventData?: Prisma.InputJsonValue;
  },
): Promise<boolean> {
  if (!canTransitionDelivery(input.from, input.to))
    throw new Error(`Transição inválida: ${input.from} -> ${input.to}`);
  const r = await tx.delivery.updateMany({
    where: { ...input.where, id: input.id, status: input.from },
    data: { ...input.data, status: input.to },
  });
  if (r.count === 0) return false;
  await recordEvent(tx, {
    deliveryId: input.id,
    type: 'STATUS',
    fromStatus: input.from,
    toStatus: input.to,
    actorId: input.actorId,
    reason: input.reason,
    data: input.eventData,
  });
  return true;
}

/** Cancela (ver CANCEL_RULES) e encerra ofertas pendentes. Quem chama valida ator/estado antes. */
export async function cancelDelivery(
  tx: Tx,
  input: {
    id: string;
    from: DeliveryStatus;
    reason: CancelReason;
    note?: string;
    actorId?: string | null;
  },
): Promise<boolean> {
  const ok = await moveStatus(tx, {
    id: input.id,
    from: input.from,
    to: 'CANCELADO',
    data: { cancelReason: input.reason, cancelNote: input.note, cancelledAt: new Date() },
    actorId: input.actorId,
    reason: input.reason,
  });
  if (ok)
    await tx.deliveryOffer.updateMany({
      where: { deliveryId: input.id, status: 'PENDENTE' },
      data: { status: 'CANCELADA', respondedAt: new Date() },
    });
  return ok;
}
