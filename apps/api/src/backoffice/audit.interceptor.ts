import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, concatMap } from 'rxjs';
import { auditAction, shouldAudit } from '@amma/shared';
import { AuditService } from './audit.service';

/** Campos de corpo que carregam o motivo/justificativa de uma ação (variam por rota). */
const REASON_FIELDS = ['reason', 'note', 'response', 'decisionReason', 'resolution'];

/**
 * Registra na trilha toda ação de admin que mexe em algo (e a abertura de dado sensível).
 * Vale para QUALQUER rota /admin/*, inclusive as que forem criadas depois: ninguém precisa lembrar de auditar.
 * Não guarda o corpo da requisição (pode ter dado pessoal), só os ids da rota e o motivo.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const pattern: string | undefined = req.route?.path;
    if (!pattern?.startsWith('/admin/') || !shouldAudit(req.method, pattern)) return next.handle();
    return next.handle().pipe(
      // Grava ANTES de responder: quem recebeu "ok" já tem o registro na trilha.
      concatMap(async (result) => {
        const user = req.user as { id: string } | undefined;
        if (!user) return result;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const field = REASON_FIELDS.find((f) => typeof body[f] === 'string' && body[f]);
        await this.audit.record({
          actorId: user.id,
          action: auditAction(req.method, pattern),
          params: { ...(req.params as Record<string, string>) },
          reason: field ? String(body[field]).trim().slice(0, 1000) : null,
          ip: req.ip ?? null,
        });
        return result;
      }),
    );
  }
}
