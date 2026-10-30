import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';

const PUBLIC_KEY = 'isPublic';
/** Marca uma rota (ou controller) como aberta de propósito, sem login. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Guard GLOBAL de "negar por padrão": toda rota HTTP precisa de `AuthGuard` (no controller ou na
 * rota) ou de `@Public()`. Esquecer o guard num controller novo vira 403, não uma rota aberta.
 */
@Injectable()
export class DenyByDefaultGuard implements CanActivate {
  private readonly logger = new Logger('Guard');

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const guards = targets.flatMap(
      (t) => (Reflect.getMetadata(GUARDS_METADATA, t) ?? []) as unknown[],
    );
    if (guards.includes(AuthGuard)) return true;
    this.logger.error(
      `Rota sem AuthGuard nem @Public(): ${context.getClass().name}.${context.getHandler().name}`,
    );
    throw new ForbiddenException();
  }
}
