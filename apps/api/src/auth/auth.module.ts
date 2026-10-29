import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OtpSender } from './otp-sender';
import { ACCESS_TTL } from './refresh';
import { RolesGuard } from './roles';

// Global: guards e serviços básicos ficam disponíveis para os outros módulos.
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) throw new Error('JWT_SECRET não definido (veja .env.example)');
        return { secret, signOptions: { expiresIn: ACCESS_TTL } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RolesGuard, OtpSender, PrismaService, StorageService],
  exports: [JwtModule, AuthGuard, RolesGuard, PrismaService, StorageService],
})
export class AuthModule {}
