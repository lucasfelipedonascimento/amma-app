import {
  AMENITIES,
  HOST_BENEFIT_KINDS,
  POINT_CAPACITY_MAX,
  POINT_REPORT_CATEGORIES,
  POINT_REPORT_TEXT_MAX,
  POINT_REPORT_STATUSES,
  POINT_STATUSES,
  POINT_TYPES,
  RATING_COMMENT_MAX,
  type Amenity,
  type HostBenefitKind,
  type PointReportCategory,
  type PointType,
} from '@amma/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePointDto {
  @IsIn(POINT_TYPES) type!: PointType;
  @IsString() @MinLength(3) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsString() @MinLength(5) @MaxLength(200) address!: string;
  @IsString() @MinLength(2) @MaxLength(80) neighborhood!: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  /** OpeningHours; conferido por `validateHours`. */
  @IsObject() hours!: Record<string, unknown>;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(AMENITIES.length)
  @IsIn(AMENITIES, { each: true })
  amenities!: Amenity[];
  @IsInt() @Min(1) @Max(POINT_CAPACITY_MAX) capacity!: number;
  @IsOptional() @IsIn(HOST_BENEFIT_KINDS) benefitKind?: HostBenefitKind;
  /** Só casa parceira: { CHAVE: true, ... }; conferido por `missingChecklistItems`. */
  @IsOptional() @IsObject() checklist?: Record<string, unknown>;
}

/** Só o que pode mudar depois de cadastrado. Endereço, posição e tipo exigem um novo cadastro. */
export class UpdatePointDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsObject() hours?: Record<string, unknown>;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(AMENITIES.length)
  @IsIn(AMENITIES, { each: true })
  amenities?: Amenity[];
  @IsOptional() @IsInt() @Min(1) @Max(POINT_CAPACITY_MAX) capacity?: number;
  @IsOptional() @IsIn(HOST_BENEFIT_KINDS) benefitKind?: HostBenefitKind;
}

const CSV = /^[A-Z_]+(,[A-Z_]+)*$/;

/** Filtros do mapa. `types` e `amenities` vão separados por vírgula. */
export class PointListQuery {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(30_000) radiusMeters?: number;
  @IsOptional() @Matches(CSV) types?: string;
  @IsOptional() @Matches(CSV) amenities?: string;
  @IsOptional() @IsIn(['true', 'false']) openNow?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(5) minRating?: number;
}

export class PointViewQuery {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
}

export class CheckInDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class PointRatingDto {
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsOptional() @IsString() @MaxLength(RATING_COMMENT_MAX) comment?: string;
}

export class PointReportDto {
  @IsIn(POINT_REPORT_CATEGORIES) category!: PointReportCategory;
  @IsOptional() @IsString() @MaxLength(POINT_REPORT_TEXT_MAX) text?: string;
}

export class AdminPointListQuery {
  @IsOptional() @IsIn(POINT_STATUSES) status?: string;
}

export class ApprovePointDto {
  @IsBoolean() identityChecked!: boolean;
  @IsBoolean() placeChecked!: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Recusar, remover e reativar sempre levam um motivo. */
export class PointNoteDto {
  @IsString() @MinLength(5) @MaxLength(500) note!: string;
}

export class ReportListQuery {
  @IsOptional() @IsIn(POINT_REPORT_STATUSES) status?: string;
}

export class ResolveReportDto {
  @IsIn(['PROCEDENTE', 'IMPROCEDENTE']) outcome!: 'PROCEDENTE' | 'IMPROCEDENTE';
  @IsString() @MinLength(5) @MaxLength(500) response!: string;
  /** Só com PROCEDENTE: tira o ponto do ar junto. */
  @IsOptional() @IsBoolean() removePoint?: boolean;
}
