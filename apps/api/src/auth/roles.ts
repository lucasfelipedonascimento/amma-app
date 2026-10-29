import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAnyRole } from '@amma/shared';

const ROLES_KEY = 'roles';

/** Uso: @UseGuards(AuthGuard, RolesGuard) @Roles('MOTORISTA'). O guard de login deve vir antes. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Sem @Roles, o guard não restringe. Com @Roles, nega por padrão.
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest().user as { roles: string[] } | undefined;
    if (!user || !hasAnyRole(user.roles, required))
      throw new ForbiddenException('Sem permissão para este recurso');
    return true;
  }
}
