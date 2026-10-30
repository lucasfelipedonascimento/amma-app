import type { Coords } from './types';

/**
 * Ponte entre quem LÊ a posição (tarefa de segundo plano ou observador em primeiro plano) e quem
 * USA (provider da tela). A tarefa do sistema roda fora do React; este módulo é o ponto de encontro.
 */
type Listener = (p: Coords) => void;
const listeners = new Set<Listener>();

export function subscribePositions(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const hasPositionListeners = () => listeners.size > 0;

export function publishPosition(p: Coords) {
  listeners.forEach((fn) => fn(p));
}
