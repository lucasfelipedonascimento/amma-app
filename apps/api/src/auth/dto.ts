import { IsEmail, IsIn, IsString, MinLength, ArrayNotEmpty, IsArray } from 'class-validator';

// ADMIN nunca pode ser escolhido no cadastro; é atribuído manualmente.
export const SELF_SERVICE_ROLES = ['PASSENGER', 'WORKER', 'MERCHANT'] as const;
export type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number];

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(2) name!: string;
  @IsArray() @ArrayNotEmpty() @IsIn(SELF_SERVICE_ROLES, { each: true }) roles!: SelfServiceRole[];
}

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
