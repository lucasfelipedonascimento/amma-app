import { MERCHANT_REPORT_PERIODS } from '@amma/shared';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class MerchantDto {
  @IsString() @MinLength(2) @MaxLength(80) tradeName!: string;
  /** Opcional; com ou sem máscara. */
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
  @IsString() @MinLength(5) @MaxLength(200) address!: string;
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class ReportQuery {
  @IsOptional() @Type(() => Number) @IsIn(MERCHANT_REPORT_PERIODS) days?: number;
}
