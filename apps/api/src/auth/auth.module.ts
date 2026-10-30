import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { RedisService } from '../common/redis.service';
import { IpRateLimitGuard, RateLimitService } from '../common/rate-limit';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OtpSender } from './otp-sender';
import { DenyByDefaultGuard } from './public';
import { assertJwtSecret, jwtOptions } from './jwt-config';
import { ReauthGuard, ReauthService } from './reauth';
import { RolesGuard } from './roles';

// Global: guards e serviços básicos ficam disponíveis para os outros módulos.
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        jwtOptions(assertJwtSecret(config.get<string>('JWT_SECRET'), config.get('NODE_ENV'))),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    RolesGuard,
    OtpSender,
    PrismaService,
    StorageService,
    RedisService,
    RateLimitService,
    ReauthService,
    ReauthGuard,
    // Guards globais, nesta ordem: limite por IP → negar por padrão (sem AuthGuard/@Public).
    { provide: APP_GUARD, useClass: IpRateLimitGuard },
    { provide: APP_GUARD, useClass: DenyByDefaultGuard },
  ],
  exports: [
    JwtModule,
    AuthGuard,
    RolesGuard,
    PrismaService,
    StorageService,
    RedisService,
    RateLimitService,
    ReauthService,
    ReauthGuard,
  ],
})
export class AuthModule {}
