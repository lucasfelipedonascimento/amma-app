import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { normalizeBrazilPhone } from '@amma/shared';
import { randomToken, safeEqual, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma.service';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_FAILED_PER_HOUR,
  OTP_MAX_REQUESTS,
  OTP_MAX_REQUESTS_PER_DAY,
  OTP_REQUEST_WINDOW_MS,
  OTP_TTL_MS,
  evaluateOtp,
  generateOtpCode,
  hashOtp,
} from './otp';
import { OtpSender } from './otp-sender';
import { REFRESH_TTL_MS, evaluateRefresh } from './refresh';
import { ReauthService } from './reauth';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class AuthService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sender: OtpSender,
    private readonly reauth: ReauthService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('JWT_SECRET');
  }

  async requestOtp(rawPhone: string) {
    const phone = this.phone(rawPhone);
    const now = new Date();
    const recent = await this.prisma.otpCode.count({
      where: { phone, createdAt: { gt: new Date(now.getTime() - OTP_REQUEST_WINDOW_MS) } },
    });
    const perDay = await this.prisma.otpCode.count({
      where: { phone, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
    });
    if (recent >= OTP_MAX_REQUESTS || perDay >= OTP_MAX_REQUESTS_PER_DAY) {
      throw new HttpException(
        'Muitas solicitações. Tente novamente em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = generateOtpCode();
    await this.prisma.otpCode.create({
      data: {
        phone,
        codeHash: hashOtp(this.secret, phone, code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
    });
    const sent = await this.sender.send(phone, code);
    return { expiresInSeconds: OTP_TTL_MS / 1000, ...sent };
  }

  async verifyOtp(rawPhone: string, code: string) {
    const phone = this.phone(rawPhone);
    await this.consumeOtp(phone, code);
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    const user =
      existing ??
      (await this.prisma.user.create({ data: { phone, roles: [], quotaAccount: { create: {} } } }));
    return { ...(await this.issueTokens(user.id)), needsOnboarding: user.roles.length === 0 };
  }

  /** Reautenticação: manda um código para o telefone da PRÓPRIA conta (nunca para um informado). */
  async requestReauth(userId: string) {
    return this.requestOtp(await this.phoneOf(userId));
  }

  /** Confirma o código e libera ações críticas por REAUTH_TTL_SECONDS. */
  async verifyReauth(userId: string, code: string) {
    await this.consumeOtp(await this.phoneOf(userId), code);
    await this.reauth.grant(userId);
    return { reauthenticated: true };
  }

  /** Encerra todas as sessões da pessoa (todos os aparelhos) e a liberação de ações críticas. */
  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.reauth.revoke(userId);
  }

  /**
   * Confere e consome o código. A tentativa é contada ANTES da comparação e de forma atômica
   * (como o PIN de embarque): requisições paralelas não furam o limite de 5. Além disso, no
   * máximo OTP_MAX_FAILED_PER_HOUR erros por telefone por hora, somando todos os códigos.
   */
  private async consumeOtp(phone: string, code: string): Promise<void> {
    const now = new Date();
    const record = await this.prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    // Mesma resposta para "sem código" e "código errado": não revela nada.
    if (!record) throw new UnauthorizedException('Código inválido');

    const failed = await this.prisma.otpCode.aggregate({
      where: { phone, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
      _sum: { attempts: true },
    });
    if ((failed._sum.attempts ?? 0) >= OTP_MAX_FAILED_PER_HOUR)
      throw new HttpException(
        'Muitas tentativas. Tente novamente mais tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const reserved = await this.prisma.otpCode.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: OTP_MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (reserved.count !== 1) {
      const verdict = evaluateOtp(record, '', now);
      throw new UnauthorizedException(
        verdict === 'EXPIRED' ? 'Código expirado' : 'Código inválido',
      );
    }
    if (!safeEqual(record.codeHash, hashOtp(this.secret, phone, code)))
      throw new UnauthorizedException('Código inválido');
    // Consumo atômico: se duas requisições chegarem juntas com o código certo, só uma passa.
    const claimed = await this.prisma.otpCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new UnauthorizedException('Código inválido');
  }

  private async phoneOf(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user?.phone) throw new UnauthorizedException();
    return user.phone;
  }

  async refresh(refreshToken: string) {
    const now = new Date();
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (!record) throw new UnauthorizedException();
    const verdict = evaluateRefresh(record, now);
    if (verdict === 'REUSED') {
      // Token já usado sendo reapresentado: encerra todas as sessões deste usuário.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    if (verdict !== 'OK') throw new UnauthorizedException();
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (rotated.count !== 1) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    return this.issueTokens(user.id);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string) {
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    // O JWT leva só o id; papéis são lidos do banco a cada requisição (nunca ficam velhos).
    return { accessToken: await this.jwt.signAsync({ sub: userId }), refreshToken };
  }

  private phone(raw: string): string {
    const phone = normalizeBrazilPhone(raw);
    if (!phone) throw new BadRequestException('Telefone inválido. Use um celular com DDD.');
    return phone;
  }
}
