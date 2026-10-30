import {
  ASSOCIATION_RATES,
  CANCEL_REASONS,
  DECLINE_REASONS,
  DELIVERY_STATUSES,
  type CancelReason,
  type DeclineReason,
  type DeliveryStatus,
} from '@amma/shared';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
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

export class CreateDeliveryDto {
  @IsDefined() @ValidateNested() @Type(() => PlaceDto) pickup!: PlaceDto;
  @IsDefined() @ValidateNested() @Type(() => PlaceDto) dropoff!: PlaceDto;
  @IsOptional() @IsString() @MaxLength(280) notes?: string;
}

export class CancelDto {
  @IsIn(CANCEL_REASONS) reason!: CancelReason;
  @IsOptional() @IsString() @MaxLength(280) note?: string;
}

export class ListDeliveriesQuery {
  @IsOptional() @IsIn(DELIVERY_STATUSES) status?: DeliveryStatus;
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
}
