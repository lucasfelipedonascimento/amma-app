import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRateLimit } from '../common/rate-limit';
import { ExportService } from './export.service';
import { AllowBlocked, AuthGuard, AuthUser } from '../auth/auth.guard';
import { AccountService } from './account.service';
import { OnboardingDto } from './dto';

@Controller('me')
@UseGuards(AuthGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @AllowBlocked()
  me(@Req() req: { user: AuthUser }) {
    return this.account.me(req.user.id);
  }

  @Post('onboarding')
  @HttpCode(200)
  onboarding(@Req() req: { user: AuthUser }, @Body() dto: OnboardingDto) {
    return this.account.onboarding(req.user.id, dto);
  }

  /** Exportação dos dados do titular (LGPD). No máximo 3 por dia: a consulta é pesada. */
  @Get('export')
  @AllowBlocked() // direito do titular: bloqueio não impede
  @UserRateLimit(3, 86400)
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="meus-dados-amma.json"')
  export(@Req() req: { user: AuthUser }) {
    return this.exporter.export(req.user.id);
  }

  @Delete()
  @AllowBlocked()
  @HttpCode(204)
  async remove(@Req() req: { user: AuthUser }) {
    await this.account.deleteAccount(req.user.id);
  }
}
