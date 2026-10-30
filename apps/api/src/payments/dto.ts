import { PAYMENT_METHODS, type PaymentMethod } from '@amma/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class PaymentChoiceDto {
  @IsIn(PAYMENT_METHODS) method!: PaymentMethod;
  /** Obrigatório no cartão: token do provedor (nunca o número do cartão). */
  @IsOptional() @IsString() @Length(8, 120) cardToken?: string;
}

/** Só no sandbox: o app manda os dados do cartão de teste e recebe um token, como faria com o SDK do provedor. */
export class SandboxCardDto {
  @IsString() @Matches(/^[\d ]{13,23}$/) number!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) expMonth!: number;
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) expYear!: number;
  @IsString() @Matches(/^\d{3,4}$/) cvv!: string;
}
