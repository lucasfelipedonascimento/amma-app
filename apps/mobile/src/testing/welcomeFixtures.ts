import { api } from '../api';
import type { HistoryItem, VisitItem, WelcomePointView } from '../welcome/types';

export const point = (over: Partial<WelcomePointView> = {}): WelcomePointView => ({
  id: 'p1',
  type: 'COMERCIO',
  name: 'Padaria Boa Hora',
  description: null,
  neighborhood: 'Manaíra',
  address: 'Rua das Flores, 100',
  reference: null,
  lat: -7.115,
  lng: -34.861,
  approximate: false,
  hours: { always: true, slots: [] },
  openNow: true,
  amenities: ['AGUA', 'BANHEIRO'],
  capacity: 4,
  occupied: 1,
  photos: [],
  rating: { average: 4.3, count: 12 },
  hasHost: true,
  isOwner: false,
  distanceMeters: 450,
  ...over,
});

export const historyItem = (over: Partial<HistoryItem> = {}): HistoryItem => ({
  id: 'c1',
  pointId: 'p1',
  startedAt: '2026-11-02T15:00:00Z',
  endedAt: '2026-11-02T15:40:00Z',
  completed: true,
  expiresAt: '2026-11-02T19:00:00Z',
  minMinutes: 5,
  point: { id: 'p1', name: 'Padaria Boa Hora', type: 'COMERCIO', neighborhood: 'Manaíra' },
  rated: false,
  canRate: true,
  ...over,
});

export const visit = (over: Partial<VisitItem> = {}): VisitItem => ({
  id: 'v1',
  endedAt: '2026-11-02T15:40:00Z',
  minutes: 40,
  visitorName: 'Ana',
  visitorRating: { average: null, count: 1 },
  rated: false,
  canRate: true,
  ...over,
});

type Handler = unknown | ((opts: { method: string; body?: Record<string, unknown> }) => unknown);

/**
 * Responde as chamadas da API pelo "MÉTODO caminho". A chave pode ser um texto exato ou uma
 * expressão (útil para o mapa, cujo caminho leva os filtros na query).
 */
export function welcomeRoutes(table: [string | RegExp, Handler][]) {
  (api as jest.Mock).mockImplementation(
    async (path: string, opts: { method?: string; body?: Record<string, unknown> } = {}) => {
      const method = opts.method ?? (opts.body ? 'POST' : 'GET');
      const key = `${method} ${path}`;
      const hit = table.find(([k]) => (typeof k === 'string' ? k === key : k.test(key)));
      if (!hit) throw new Error(`rota sem resposta no teste: ${key}`);
      const h = hit[1];
      return typeof h === 'function'
        ? (h as (o: unknown) => unknown)({ method, body: opts.body })
        : h;
    },
  );
}

/** Corpos enviados a uma chamada, na ordem. */
export const sent = (method: string, pathStart: string): Record<string, unknown>[] =>
  (api as jest.Mock).mock.calls
    .filter(
      ([p, o]) =>
        (p as string).startsWith(pathStart) &&
        ((o as { method?: string })?.method ??
          ((o as { body?: unknown })?.body ? 'POST' : 'GET')) === method,
    )
    .map(([, o]) => (o as { body: Record<string, unknown> }).body);

export const paths = (): string[] => (api as jest.Mock).mock.calls.map(([p]) => p as string);
