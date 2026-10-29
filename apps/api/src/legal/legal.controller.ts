import { Controller, Get } from '@nestjs/common';
import { PRIVACY_POLICY_TEXT, PRIVACY_POLICY_VERSION } from './privacy-policy';

@Controller('legal')
export class LegalController {
  @Get('privacy-policy')
  privacyPolicy() {
    return { version: PRIVACY_POLICY_VERSION, text: PRIVACY_POLICY_TEXT };
  }
}
