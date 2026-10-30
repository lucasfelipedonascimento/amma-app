import {
  APPROVAL_STATUSES,
  CANCEL_REASONS,
  CLAIM_KINDS,
  CLAIM_STATUSES,
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
  VOTE_CHOICES,
  DELIVERY_KINDS,
  DELIVERY_STATUSES,
  DOCUMENT_TYPES,
  EMERGENCY_STATUSES,
  GENDERS,
  PRICING_PROFILES,
  RATING_DIRECTIONS,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  RIDE_VEHICLE_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  RIDE_STATUSES,
  ROLES,
} from '@amma/shared';
import {
  ApprovalStatus,
  ClaimKind,
  ClaimStatus,
  ProposalKind,
  ProposalStatus,
  VoteChoice,
  CancelReason,
  DeliveryKind,
  DeliveryStatus,
  DocumentType,
  EmergencyStatus,
  Gender,
  RatingDirection,
  ReportCategory,
  ReportStatus,
  VehicleType,
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
    ['DeliveryKind', DeliveryKind, DELIVERY_KINDS],
    ['Gender', Gender, GENDERS],
    ['RatingDirection', RatingDirection, RATING_DIRECTIONS],
    ['ReportCategory', ReportCategory, REPORT_CATEGORIES],
    ['ReportStatus', ReportStatus, REPORT_STATUSES],
    ['EmergencyStatus', EmergencyStatus, EMERGENCY_STATUSES],
    ['VehicleType', VehicleType, RIDE_VEHICLE_TYPES],
    ['ProposalKind', ProposalKind, PROPOSAL_KINDS],
    ['ProposalStatus', ProposalStatus, PROPOSAL_STATUSES],
    ['VoteChoice', VoteChoice, VOTE_CHOICES],
    ['ClaimKind', ClaimKind, CLAIM_KINDS],
    ['ClaimStatus', ClaimStatus, CLAIM_STATUSES],
  ])('%s', (_name, prismaEnum, shared) => {
    expect(Object.keys(prismaEnum).sort()).toEqual([...shared].sort());
  });
});

// O perfil de preço é texto no banco (não enum); o shared é a única lista.
describe('perfis de preço', () => {
  it('entrega e uma corrida por tipo de veículo', () => {
    expect([...PRICING_PROFILES]).toEqual(['ENTREGA', 'CORRIDA_CARRO', 'CORRIDA_MOTO']);
  });
});
