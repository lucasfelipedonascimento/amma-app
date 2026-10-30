import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RedisService } from './redis.service';

export interface Limit {
  /** Requisições permitidas por janela. */
  limit: number;
  windowSeconds: number;
}

/** Limite padrão por IP (qualquer rota). Folgado: o alvo são robôs, não o uso normal do app. */
export const DEFAULT_IP_LIMIT: Limit = { limit: 300, windowSeconds: 60 };

const RATE_KEY = 'rateLimit';
/** Limite específico (por IP) de uma rota, no lugar do padrão. Ex.: `@RateLimit(10, 60)`. */
export const RateLimit = (limit: number, windowSeconds: number) =>
  SetMetadata(RATE_KEY, { limit, windowSeconds } satisfies Limit);

/**
 * Contador por janela fixa no Redis. Se o Redis cair, deixa passar (mesma regra do resto da API:
 * Redis é aceleração; as travas que protegem dinheiro e login ficam no banco).
 * `RATE_LIMIT_SCALE` multiplica todos os limites (os testes de integração usam um valor alto).
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger('RateLimit');

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Conta uma requisição e devolve os segundos até liberar, ou 0 se está dentro do limite. */
  async hit(name: string, id: string, { limit, windowSeconds }: Limit): Promise<number> {
    const scale = Number(this.config.get('RATE_LIMIT_SCALE') ?? 1) || 1;
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `rl:${name}:${id}:${window}`;
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, windowSeconds);
      if (n <= limit * scale) return 0;
      return Math.max(1, windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds));
    } catch (e) {
      this.logger.warn(`Limite de taxa ignorado (Redis): ${(e as Error).message}`);
      return 0;
    }
  }
}

export function tooMany(res: { setHeader(k: string, v: string): void }, retryAfter: number): never {
  res.setHeader('Retry-After', String(retryAfter));
  throw new HttpException(
    'Muitas requisições. Tente novamente em instantes.',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Guard GLOBAL: limita por IP (com `trust proxy` configurado, o IP real do cliente).
 * A rota pode trocar o limite com `@RateLimit`. O bucket é por rota, então uma rota ruidosa
 * não gasta a cota das outras.
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimitService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<{ ip?: string; method: string; route?: { path?: string } }>();
    const custom = this.reflector.getAllAndOverride<Limit | undefined>(RATE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const wait = await this.limiter.hit(
      custom ? route : 'default',
      req.ip ?? 'unknown',
      custom ?? DEFAULT_IP_LIMIT,
    );
    if (wait) tooMany(http.getResponse(), wait);
    return true;
  }
}

const USER_RATE_KEY = 'userRateLimit';

/** Guard por USUÁRIO (vem depois do AuthGuard). Usar via `@UserRateLimit`. */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimitService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const cfg = this.reflector.get<Limit>(USER_RATE_KEY, context.getHandler());
    const user = http.getRequest<{ user?: { id: string } }>().user;
    if (!cfg || !user) return true;
    const wait = await this.limiter.hit(
      `user:${context.getClass().name}.${context.getHandler().name}`,
      user.id,
      cfg,
    );
    if (wait) tooMany(http.getResponse(), wait);
    return true;
  }
}

/** Limite por usuário logado numa rota. O AuthGuard da rota precisa vir antes. */
export const UserRateLimit = (limit: number, windowSeconds: number) =>
  applyDecorators(
    SetMetadata(USER_RATE_KEY, { limit, windowSeconds } satisfies Limit),
    UseGuards(UserRateLimitGuard),
  );
