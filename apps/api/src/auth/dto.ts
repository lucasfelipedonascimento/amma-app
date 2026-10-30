import { IsString, Length, MaxLength } from 'class-validator';

export class RequestOtpDto {
  @IsString() @MaxLength(20) phone!: string;
}

export class VerifyOtpDto {
  @IsString() @MaxLength(20) phone!: string;
  @IsString() @Length(6, 6) code!: string;
}

export class RefreshDto {
  @IsString() @MaxLength(256) refreshToken!: string;
}

export class ReauthDto {
  @IsString() @Length(6, 6) code!: string;
}
