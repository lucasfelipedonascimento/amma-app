import {
  CLAIM_KINDS,
  PROPOSAL_KINDS,
  RIDE_VEHICLE_TYPES,
  VOTE_CHOICES,
  type ClaimKind,
  type ProposalKind,
  type RideVehicleType,
  type VoteChoice,
} from '@amma/shared';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const KEY = /^[\w-]{8,64}$/;

export class CreateProposalDto {
  @IsIn(PROPOSAL_KINDS) kind!: ProposalKind;
  @IsString() @MinLength(5) @MaxLength(120) title!: string;
  @IsString() @MinLength(10) @MaxLength(4000) description!: string;
  /** Só para REGRA_COMPRA_COLETIVA, ex.: {"minQuotas": 5}. */
  @IsOptional() @IsObject() ruleChange?: Record<string, unknown>;
  @IsDateString() closesAt!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) quorumPercent?: number;
}

export class VoteDto {
  @IsIn(VOTE_CHOICES) choice!: VoteChoice;
}

export class ProposalListQuery {
  @IsOptional() @IsIn(['abertas', 'encerradas']) filter?: 'abertas' | 'encerradas';
}

export class CreateGroupDto {
  @IsString() @MinLength(3) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsIn(RIDE_VEHICLE_TYPES) vehicleType!: RideVehicleType;
  @IsInt() @Min(1) targetCents!: number;
}

export class ContributionDto {
  @IsInt() @Min(1) amountCents!: number;
  /** Mesma chave = mesmo aporte (duplo toque ou nova tentativa não registra duas vezes). */
  @IsOptional() @IsString() @Matches(KEY) idempotencyKey?: string;
}

export class CreateClaimDto {
  @IsIn(CLAIM_KINDS) kind!: ClaimKind;
  @IsDateString() occurredAt!: string;
  @IsString() @MinLength(10) @MaxLength(2000) description!: string;
  @IsInt() @Min(1) requestedCents!: number;
}

export class ClaimListQuery {
  @IsOptional() @IsIn(['ENVIADA', 'EM_ANALISE', 'APROVADA', 'NEGADA', 'CANCELADA']) status?: string;
}

export class ClaimDecisionDto {
  @IsIn(['APROVADA', 'NEGADA']) decision!: 'APROVADA' | 'NEGADA';
  @IsString() @MaxLength(1000) note!: string;
  @IsOptional() @IsInt() @Min(1) approvedCents?: number;
}

export class SurplusSimulateDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2200) year!: number;
  @IsInt() @Min(1) distributableCents!: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) useWeightPercent?: number;
}

export class SurplusCloseDto extends SurplusSimulateDto {
  /** Resumo devolvido pela simulação: prova que o fechamento é do que o admin viu. */
  @IsString() @Matches(/^[0-9a-f]{64}$/) checksum!: string;
}
