import {
  APPROVAL_STATUSES,
  CANCEL_REASONS,
  DELIVERY_STATUSES,
  DOCUMENT_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  RIDE_STATUSES,
  ROLES,
} from '@amma/shared';
import {
  ApprovalStatus,
  CancelReason,
  DeliveryStatus,
  DocumentType,
  PaymentMethod,
  PaymentStatus,
  RideStatus,
  Role,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

// Enums do banco e do shared não podem divergir.
describe('enums Prisma x shared', () => {
  it.each([
    ['RideStatus', RideStatus, RIDE_STATUSES],
    ['DeliveryStatus', DeliveryStatus, DELIVERY_STATUSES],
    ['CancelReason', CancelReason, CANCEL_REASONS],
    ['Role', Role, ROLES],
    ['ApprovalStatus', ApprovalStatus, APPROVAL_STATUSES],
    ['DocumentType', DocumentType, DOCUMENT_TYPES],
    ['PaymentStatus', PaymentStatus, PAYMENT_STATUSES],
    ['PaymentMethod', PaymentMethod, PAYMENT_METHODS],
  ])('%s', (_name, prismaEnum, shared) => {
    expect(Object.keys(prismaEnum).sort()).toEqual([...shared].sort());
  });
});
