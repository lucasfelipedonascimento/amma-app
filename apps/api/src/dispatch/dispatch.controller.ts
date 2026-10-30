import { Controller, Get } from '@nestjs/common';
import { CANCEL_RULES, DISPATCH_REASONS, DISPATCH_RULES } from '@amma/shared';
import { DispatchSettingsService } from './dispatch-settings.service';

/** Regras públicas: qualquer pessoa pode ler como o despacho decide. Sem autenticação. */
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly settings: DispatchSettingsService) {}

  @Get('rules')
  async rules() {
    return {
      rules: DISPATCH_RULES,
      reasons: DISPATCH_REASONS,
      cancelRules: CANCEL_RULES,
      config: await this.settings.get(),
    };
  }
}
