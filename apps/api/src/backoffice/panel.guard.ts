import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { canAccessSection, panelRolesFor, type PanelRole } from '@amma/shared';
import { MembersService } from '../association/members.service';
import type { AuthUser } from '../auth/auth.guard';

const PANEL_KEY = 'panelRoles';

/** Quem pode usar a rota do painel: `@PanelAccess('ADMIN', 'SOCIO')`. O AuthGuard vem antes. */
export const PanelAccess = (...roles: PanelRole[]) => SetMetadata(PANEL_KEY, roles);

/** Papéis de painel de uma pessoa: ADMIN pelo papel; SOCIO = motorista com cotas (lidas do ledger). */
@Injectable()
export class PanelAccessService {
  constructor(private readonly members: MembersService) {}

  async rolesOf(user: Pick<AuthUser, 'id' | 'roles'>): Promise<PanelRole[]> {
    const member = user.roles.includes('MOTORISTA') && (await this.members.isMember(user.id));
    return panelRolesFor(user.roles, member);
  }
}

@Injectable()
export class PanelGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: PanelAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PanelRole[]>(PANEL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest();
    const roles = await this.access.rolesOf(req.user as AuthUser);
    // Sem @PanelAccess, nega por padrão (esquecer o decorator não abre a rota).
    if (!required?.some((r) => roles.includes(r)))
      throw new ForbiddenException('Sem permissão para o painel');
    req.panelRoles = roles;
    return true;
  }
}

// Reexportado para quem monta menus a partir do mesmo critério.
export { canAccessSection };
