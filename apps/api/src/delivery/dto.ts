import {
  ASSOCIATION_RATES,
  BOARDING_PIN_LENGTH,
  CANCEL_CATEGORY_KEYS,
  CANCEL_REASONS,
  DECLINE_REASONS,
  DELIVERY_STATUSES,
  PRICING_PROFILES,
  RATING_COMMENT_MAX,
  REPORT_CATEGORIES,
  REPORT_DESCRIPTION_MAX,
  REPORT_DESCRIPTION_MIN,
  REPORT_STATUSES,
  EMERGENCY_STATUSES,
  RIDE_VEHICLE_TYPES,
  DELIVERY_KINDS,
  type DeliveryKind,
  type EmergencyStatus,
  type PricingProfile,
  type ReportCategory,
  type ReportStatus,
  type RideVehicleType,
  type CancelReason,
  type DeclineReason,
  type DeliveryStatus,
} from '@amma/shared';
import { Type } from 'class-transformer';
import { PaymentChoiceDto } from '../payments/dto';
import {
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class LatLngDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class RouteQuery {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class PushTokenDto {
  @Matches(/^Expo(nent)?PushToken\[[\w-]{10,}\]$/, { message: 'token de push inválido' })
  token!: string;
  @IsIn(['android', 'ios']) platform!: 'android' | 'ios';
}

export class ConsentDto {
  @IsString() version!: string;
}

export class PlaceDto extends LatLngDto {
  @IsString() @MinLength(3) @MaxLength(200) address!: string;
}

export class QuoteDto {
  @IsDefined() @ValidateNested() @Type(() => PlaceDto) pickup!: PlaceDto;
  @IsDefined() @ValidateNested() @Type(() => PlaceDto) dropoff!: PlaceDto;
  @IsOptional() @IsString() @MaxLength(280) notes?: string;
}

export class CreateDeliveryDto extends QuoteDto {
  @IsDefined() @ValidateNested() @Type(() => PaymentChoiceDto) payment!: PaymentChoiceDto;
  /** O app gera um por tentativa de pedir; repetir (duplo toque, rede instável) não cria outro pedido nem cobra de novo. */
  @IsOptional() @IsString() @Matches(/^[\w-]{8,64}$/) idempotencyKey?: string;
  /** Preço que o cliente viu na cotação. Se a tabela mudou desde então, o pedido é recusado (409) antes de cobrar. */
  @IsOptional() @IsInt() @Min(1) expectedFareCents?: number;
}

export class RatingDto {
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsOptional() @IsString() @MaxLength(RATING_COMMENT_MAX) comment?: string;
}

export class RefundDto {
  @IsString() @MinLength(5) @MaxLength(280) reason!: string;
}

export class CancelDto {
  @IsIn(CANCEL_REASONS) reason!: CancelReason;
  /** Motivo escolhido no menu do app (ex.: MUDEI_DE_IDEIA). Conferido por ator no serviço. */
  @IsOptional() @IsIn(CANCEL_CATEGORY_KEYS) category?: string;
  @IsOptional() @IsString() @MaxLength(280) note?: string;
}

export class ReleaseDto {
  @IsOptional() @IsIn(CANCEL_CATEGORY_KEYS) category?: string;
}

export class ListDeliveriesQuery {
  @IsOptional() @IsIn(DELIVERY_STATUSES) status?: DeliveryStatus;
  /** Sem filtro, a lista de entregas traz só entregas; corridas vêm de GET /rides. */
  @IsOptional() @IsIn(DELIVERY_KINDS) kind?: DeliveryKind;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class DeclineDto {
  @IsOptional() @IsIn(DECLINE_REASONS) reason?: DeclineReason;
}

export class AssociationRateDto {
  @Type(() => Number) @IsIn(ASSOCIATION_RATES) rate!: 0 | 2 | 4;
}

export class DispatchSettingsDto {
  @IsInt() radiusMeters!: number;
  @IsInt() offerTtlSeconds!: number;
  @IsInt() maxSearchSeconds!: number;
  @IsInt() maxPositionAgeSeconds!: number;
}

export class PricingDto {
  @Matches(/^[\w.-]{3,40}$/, { message: 'version: 3 a 40 caracteres (letras, números, . _ -)' })
  version!: string;
  @IsDateString() effectiveFrom!: string;
  @IsInt() @Min(0) baseCents!: number;
  @IsInt() @Min(0) perKmCents!: number;
  @IsInt() @Min(0) perMinuteCents!: number;
  @IsInt() @Min(0) minimumFareCents!: number;
  /** Omitido = tabela de entregas. */
  @IsOptional() @IsIn(PRICING_PROFILES) profile?: PricingProfile;
}

// ---------------------------------------------------------------- corridas de passageiro

export class RideQuoteDto {
  @IsDefined() @ValidateNested() @Type(() => PlaceDto) pickup!: PlaceDto;
  @IsDefined() @ValidateNested() @Type(() => PlaceDto) dropoff!: PlaceDto;
  /** Com `true`, a estimativa de tempo considera só motoristas mulheres verificadas. */
  @IsOptional() @IsBoolean() womenDriverOnly?: boolean;
}

export class CreateRideDto extends RideQuoteDto {
  @IsIn(RIDE_VEHICLE_TYPES) vehicleType!: RideVehicleType;
  @IsDefined() @ValidateNested() @Type(() => PaymentChoiceDto) payment!: PaymentChoiceDto;
  @IsOptional() @IsString() @Matches(/^[\w-]{8,64}$/) idempotencyKey?: string;
  @IsOptional() @IsInt() @Min(1) expectedFareCents?: number;
}

export class BoardDto {
  /** PIN de embarque que o passageiro mostra ao motorista. */
  @IsOptional()
  @IsString()
  @Matches(new RegExp(`^\\d{${BOARDING_PIN_LENGTH}}$`), { message: 'PIN inválido' })
  pin?: string;
}

export class ShareDto {
  /** Só para o passageiro lembrar com quem compartilhou; não é enviado a ninguém. */
  @IsOptional() @IsString() @MaxLength(60) contactLabel?: string;
}

export class EmergencyDto {
  @IsOptional() @IsUUID() deliveryId?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsString() @MaxLength(280) note?: string;
}

export class EmergencyUpdateDto {
  @IsIn(EMERGENCY_STATUSES) status!: EmergencyStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ReportDto {
  /** Corrida a que a denúncia se refere. O denunciado é sempre a outra parte dela. */
  @IsOptional() @IsUUID() deliveryId?: string;
  @IsIn(REPORT_CATEGORIES) category!: ReportCategory;
  @IsString()
  @MinLength(REPORT_DESCRIPTION_MIN)
  @MaxLength(REPORT_DESCRIPTION_MAX)
  description!: string;
}

export class ReportUpdateDto {
  @IsIn(REPORT_STATUSES) status!: ReportStatus;
  /** Resposta mostrada a quem denunciou. */
  @IsOptional() @IsString() @MaxLength(500) resolution?: string;
}

export class GenderVerificationDto {
  @IsBoolean() verified!: boolean;
}

export class MunicipalRulesDto {
  @Matches(/^[\w.-]{3,40}$/, { message: 'version: 3 a 40 caracteres (letras, números, . _ -)' })
  version!: string;
  @IsDateString() effectiveFrom!: string;
  @IsObject() rules!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(300) legalReference?: string;
}
