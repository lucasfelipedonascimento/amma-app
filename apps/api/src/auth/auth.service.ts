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
import { randomToken, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma.service';
import {
  OTP_MAX_REQUESTS,
  OTP_REQUEST_WINDOW_MS,
  OTP_TTL_MS,
  evaluateOtp,
  generateOtpCode,
  hashOtp,
} from './otp';
import { OtpSender } from './otp-sender';
import { REFRESH_TTL_MS, evaluateRefresh } from './refresh';

@Injectable()
export class AuthService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sender: OtpSender,
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
    if (recent >= OTP_MAX_REQUESTS) {
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
    const now = new Date();
    const record = await this.prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    // Mesma resposta para "sem código" e "código errado": não revela nada.
    if (!record) throw new UnauthorizedException('Código inválido');

    const verdict = evaluateOtp(record, hashOtp(this.secret, phone, code), now);
    if (verdict === 'INVALID') {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
    }
    if (verdict !== 'OK') {
      throw new UnauthorizedException(
        verdict === 'EXPIRED' ? 'Código expirado' : 'Código inválido',
      );
    }
    // Consumo atômico: se duas requisições chegarem juntas, só uma passa.
    const claimed = await this.prisma.otpCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new UnauthorizedException('Código inválido');

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    const user =
      existing ??
      (await this.prisma.user.create({ data: { phone, roles: [], quotaAccount: { create: {} } } }));
    return { ...(await this.issueTokens(user.id)), needsOnboarding: user.roles.length === 0 };
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
