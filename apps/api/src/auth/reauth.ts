import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { RedisService } from '../common/redis.service';

/** Depois de confirmar um código por SMS, a pessoa fica este tempo liberada para ações críticas. */
export const REAUTH_TTL_SECONDS = 10 * 60;
const key = (userId: string) => `reauth:${userId}`;

/**
 * Reautenticação por OTP para ações administrativas críticas. O estado fica no Redis (expira sozinho).
 * Diferente do limite de taxa, aqui a falha do Redis NEGA: sem poder conferir, não libera ação crítica.
 */
@Injectable()
export class ReauthService {
  constructor(private readonly redis: RedisService) {}

  async grant(userId: string): Promise<void> {
    await this.redis.set(key(userId), '1', 'EX', REAUTH_TTL_SECONDS);
  }

  async isFresh(userId: string): Promise<boolean> {
    try {
      return (await this.redis.get(key(userId))) === '1';
    } catch {
      return false;
    }
  }

  async revoke(userId: string): Promise<void> {
    await this.redis.del(key(userId)).catch(() => undefined);
  }
}

@Injectable()
export class ReauthGuard implements CanActivate {
  constructor(private readonly reauth: ReauthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<{ user?: { id: string } }>().user;
    if (user && (await this.reauth.isFresh(user.id))) return true;
    throw new ForbiddenException({
      statusCode: 403,
      code: 'REAUTH_REQUIRED',
      message:
        'Confirme sua identidade com um código por SMS (POST /auth/reauth/request e /verify).',
    });
  }
}

/** Ação crítica: exige código por SMS confirmado nos últimos 10 min. O AuthGuard da rota vem antes. */
export const Reauth = () => applyDecorators(UseGuards(ReauthGuard));
