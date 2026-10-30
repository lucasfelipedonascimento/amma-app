import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';

export interface AuthUser {
  id: string;
  roles: string[];
  /** Conta com bloqueio em vigor (AccountBlock). Só rotas @AllowBlocked aceitam. */
  blocked: boolean;
}

const ALLOW_BLOCKED_KEY = 'allowBlocked';
/** Rota que a pessoa bloqueada ainda pode usar: ver o motivo, recorrer, ver a conta e excluí-la (LGPD). */
export const AllowBlocked = () => SetMetadata(ALLOW_BLOCKED_KEY, true);

/** Valida o JWT e carrega o usuário do banco (papéis sempre atuais; conta excluída é recusada). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const [type, token] = (req.headers.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();
    req.user = await this.authenticate(token);
    const allowBlocked = this.reflector.getAllAndOverride<boolean>(ALLOW_BLOCKED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (req.user.blocked && !allowBlocked)
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCOUNT_BLOCKED',
        message: 'Conta bloqueada. Veja o motivo e o direito de recurso em /me/block.',
      });
    return true;
  }

  /** Valida o token e carrega o usuário. Também usado pelo WebSocket. */
  async authenticate(token: string): Promise<AuthUser> {
    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    return { id: user.id, roles: user.roles, blocked: user.blockedAt !== null } satisfies AuthUser;
  }
}
