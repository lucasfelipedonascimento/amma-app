import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { APPEAL_DECISIONS, BLOCK_STATUSES, BUDGET_KINDS } from '@amma/shared';

export class ReasonDto {
  @IsString() @MaxLength(2000) reason!: string;
}

export class AppealDto {
  @IsString() @MaxLength(5000) text!: string;
}

export class AppealDecisionDto {
  @IsIn(APPEAL_DECISIONS as readonly string[]) decision!: 'ACEITO' | 'NEGADO';
  @IsString() @MaxLength(2000) reason!: string;
}

export class BlockListQuery {
  @IsOptional() @IsIn(BLOCK_STATUSES as readonly string[]) status?: (typeof BLOCK_STATUSES)[number];
  @IsOptional() @IsUUID() userId?: string;
}

export class StatusQuery {
  @IsOptional() @IsIn(['PENDENTE', 'APROVADO', 'REPROVADO']) status?:
    'PENDENTE' | 'APROVADO' | 'REPROVADO';
  @IsOptional() @IsString() @MaxLength(80) q?: string;
}

export class UserSearchQuery {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(['true', 'false']) blocked?: 'true' | 'false';
}

export class MerchantReviewDto {
  @IsIn(['APROVADO', 'REPROVADO']) status!: 'APROVADO' | 'REPROVADO';
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class OverviewQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

export class AuditQueryDto {
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsString() @MaxLength(120) action?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class BudgetEntryDto {
  @IsIn(BUDGET_KINDS as readonly string[]) kind!: (typeof BUDGET_KINDS)[number];
  @IsString() @MaxLength(40) category!: string;
  @IsString() @MaxLength(500) description!: string;
  @IsInt() @Max(100_000_000_00) amountCents!: number;
  @IsString() @MaxLength(10) occurredOn!: string;
  @IsOptional() @IsString() @MaxLength(80) receiptRef?: string;
}

export class YearQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year?: number;
}

export class ProposalFilterQuery {
  @IsOptional() @IsIn(['abertas', 'encerradas']) filter?: 'abertas' | 'encerradas';
}
