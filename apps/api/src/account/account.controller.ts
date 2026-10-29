import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { AccountService } from './account.service';
import { OnboardingDto } from './dto';

@Controller('me')
@UseGuards(AuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  me(@Req() req: { user: AuthUser }) {
    return this.account.me(req.user.id);
  }

  @Post('onboarding')
  @HttpCode(200)
  onboarding(@Req() req: { user: AuthUser }, @Body() dto: OnboardingDto) {
    return this.account.onboarding(req.user.id, dto);
  }

  @Delete()
  @HttpCode(204)
  async remove(@Req() req: { user: AuthUser }) {
    await this.account.deleteAccount(req.user.id);
  }
}
