export const ROLES = ['PASSAGEIRO', 'MOTORISTA', 'COMERCIANTE', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Papéis que o próprio usuário pode escolher. ADMIN só é atribuído manualmente. */
export const SELF_SERVICE_ROLES = ['PASSAGEIRO', 'MOTORISTA', 'COMERCIANTE'] as const;
export type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number];

export const hasAnyRole = (userRoles: readonly string[], required: readonly string[]): boolean =>
  required.some((r) => userRoles.includes(r));
