import { SELF_SERVICE_ROLES, type SelfServiceRole } from '@amma/shared';
import { ArrayNotEmpty, Equals, IsArray, IsIn, IsString, MinLength } from 'class-validator';

export class OnboardingDto {
  @IsString() @MinLength(2) name!: string;
  @IsArray() @ArrayNotEmpty() @IsIn(SELF_SERVICE_ROLES, { each: true }) roles!: SelfServiceRole[];
  // Consentimento explícito e versionado (LGPD): precisa ser exatamente `true`.
  @Equals(true, { message: 'É necessário aceitar a política de privacidade' })
  acceptPrivacyPolicy!: boolean;
  @IsString() policyVersion!: string;
}
