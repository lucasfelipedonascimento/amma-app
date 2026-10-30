import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { RateLimit } from '../common/rate-limit';
import { AllowBlocked, AuthGuard, AuthUser } from './auth.guard';
import { AuthService } from './auth.service';
import { ReauthDto, RefreshDto, RequestOtpDto, VerifyOtpDto } from './dto';
import { Public } from './public';

/** Limites por IP: o do OTP complementa o por telefone (que não vê quem varre vários números). */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit(10, 60)
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @RateLimit(10, 60)
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  @Public()
  @RateLimit(30, 60)
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @RateLimit(30, 60)
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  /** Sai de todos os aparelhos. */
  @UseGuards(AuthGuard)
  @AllowBlocked()
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@Req() req: { user: AuthUser }) {
    await this.auth.logoutAll(req.user.id);
  }

  /** Reautenticação (ações críticas do admin): código por SMS para o telefone da própria conta. */
  @UseGuards(AuthGuard)
  @RateLimit(5, 600)
  @Post('reauth/request')
  @HttpCode(200)
  requestReauth(@Req() req: { user: AuthUser }) {
    return this.auth.requestReauth(req.user.id);
  }

  @UseGuards(AuthGuard)
  @RateLimit(10, 600)
  @Post('reauth/verify')
  @HttpCode(200)
  verifyReauth(@Req() req: { user: AuthUser }, @Body() dto: ReauthDto) {
    return this.auth.verifyReauth(req.user.id, dto.code);
  }
}
