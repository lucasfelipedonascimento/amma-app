/**
 * Bloqueio de conta com motivo e direito de recurso. Regras puras; a persistência está na API.
 *
 * Fluxo: ATIVO → (pessoa recorre) EM_RECURSO → MANTIDO (recurso negado) ou REVOGADO (aceito).
 * O admin também pode revogar a qualquer momento (ATIVO/EM_RECURSO/MANTIDO → REVOGADO).
 * Só um bloqueio "em vigor" (ATIVO, EM_RECURSO ou MANTIDO) por pessoa. Uma pessoa recorre uma vez por bloqueio.
 */
export const BLOCK_STATUSES = ['ATIVO', 'EM_RECURSO', 'MANTIDO', 'REVOGADO'] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];

export const BLOCK_STATUS_LABEL: Record<BlockStatus, string> = {
  ATIVO: 'Bloqueado',
  EM_RECURSO: 'Recurso em análise',
  MANTIDO: 'Bloqueio mantido',
  REVOGADO: 'Revogado',
};

export const APPEAL_DECISIONS = ['ACEITO', 'NEGADO'] as const;
export type AppealDecision = (typeof APPEAL_DECISIONS)[number];

export const BLOCK_REASON_MIN = 10;
export const BLOCK_REASON_MAX = 1000;
export const APPEAL_TEXT_MIN = 10;
export const APPEAL_TEXT_MAX = 2000;
/** Prazo para recorrer, contado do bloqueio. Exemplo a confirmar com a associação. */
export const APPEAL_WINDOW_DAYS = 30;

/** Bloqueio que ainda impede o uso da conta. */
export const isBlockInForce = (s: BlockStatus): boolean => s !== 'REVOGADO';

export function validateReason(text: string, min: number, max: number): string | null {
  const t = text.trim();
  if (t.length < min) return `Escreva pelo menos ${min} caracteres`;
  if (t.length > max) return `No máximo ${max} caracteres`;
  return null;
}

export function appealDeadline(blockedAt: Date | string): Date {
  return new Date(new Date(blockedAt).getTime() + APPEAL_WINDOW_DAYS * 86_400_000);
}

export type AppealCheck = { ok: true } | { ok: false; reason: string };

/** A pessoa pode recorrer? Só bloqueio ATIVO, dentro do prazo (e uma única vez: ATIVO ainda não tem recurso). */
export function canAppeal(
  block: { status: BlockStatus; blockedAt: Date | string },
  now: Date,
): AppealCheck {
  if (block.status === 'EM_RECURSO') return { ok: false, reason: 'O recurso já foi enviado' };
  if (block.status !== 'ATIVO') return { ok: false, reason: 'Este bloqueio não aceita recurso' };
  if (now.getTime() > appealDeadline(block.blockedAt).getTime())
    return { ok: false, reason: `O prazo de ${APPEAL_WINDOW_DAYS} dias para recorrer terminou` };
  return { ok: true };
}

/** Estado do bloqueio depois da decisão do recurso. */
export const statusAfterAppeal = (d: AppealDecision): BlockStatus =>
  d === 'ACEITO' ? 'REVOGADO' : 'MANTIDO';

/** O admin pode revogar qualquer bloqueio em vigor. */
export const canRevoke = (s: BlockStatus): boolean => isBlockInForce(s);

/** Quem decide o recurso não pode ser quem aplicou o bloqueio (segunda opinião). */
export function canDecideAppeal(blockedById: string, adminId: string): boolean {
  return blockedById !== adminId;
}

/** Admin não bloqueia a si mesmo nem outro admin (evita trancar a associação para fora). */
export function canBlockUser(
  target: { id: string; roles: readonly string[] },
  adminId: string,
): boolean {
  return target.id !== adminId && !target.roles.includes('ADMIN');
}
