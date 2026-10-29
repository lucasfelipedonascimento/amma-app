/**
 * Estados da corrida (também usados nas entregas: ARRIVED = chegou à coleta,
 * IN_PROGRESS = a caminho do destino).
 */
export type RideStatus =
  'REQUESTED' | 'ACCEPTED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

// Cancelamento só até ARRIVED; depois de iniciada, só conclui. EXPIRED = ninguém aceitou.
const TRANSITIONS: Record<RideStatus, readonly RideStatus[]> = {
  REQUESTED: ['ACCEPTED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export const canTransition = (from: RideStatus, to: RideStatus): boolean =>
  TRANSITIONS[from].includes(to);

export const isTerminal = (status: RideStatus): boolean => TRANSITIONS[status].length === 0;

export function transition(from: RideStatus, to: RideStatus): RideStatus {
  if (!canTransition(from, to)) throw new Error(`Transição inválida: ${from} -> ${to}`);
  return to;
}
