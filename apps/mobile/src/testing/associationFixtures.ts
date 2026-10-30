import { api } from '../api';
import type {
  AssociationMe,
  Claim,
  Proposal,
  PurchaseGroupDetail,
  PurchaseGroupItem,
} from '../association/types';

export const me = (over: Partial<AssociationMe> = {}): AssociationMe => ({
  associationRate: 2,
  rateOptions: [0, 2, 4],
  quotaValueCents: 500,
  quotas: 12,
  remainderCents: 140,
  isMember: true,
  minQuotasToBeMember: 1,
  progress: {
    level: 'BRONZE',
    nextLevel: 'SILVER',
    quotasToNext: 18,
    centsToNext: 8860,
    percent: 40,
  },
  history: [],
  ...over,
});

export const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'p1',
  kind: 'GERAL',
  title: 'Reajustar a taxa',
  description: 'Discutir o reajuste anual da taxa.',
  ruleChange: null,
  status: 'ABERTA',
  opensAt: '2026-10-29T12:00:00Z',
  closesAt: '2026-11-05T12:00:00Z',
  quorumPercent: 0,
  eligibleCount: 10,
  requiredVotes: 1,
  myVote: null,
  result: null,
  ...over,
});

export const groupItem = (over: Partial<PurchaseGroupItem> = {}): PurchaseGroupItem => ({
  id: 'g1',
  name: 'Motos 2027',
  description: null,
  vehicleType: 'MOTO',
  targetCents: 2_000_000,
  status: 'ABERTO',
  fundedCents: 500_000,
  queueSize: 2,
  myStatus: null,
  ...over,
});

export const groupDetail = (over: Partial<PurchaseGroupDetail> = {}): PurchaseGroupDetail => ({
  ...groupItem(),
  availableUnits: 0,
  rules: { quotaWeight: 10, dayWeight: 1, minQuotas: 1, minContributionCents: 5000 },
  queue: [
    { position: 1, name: 'Bruno', quotas: 20, score: 200, daysInQueue: 0, isMe: false },
    { position: 2, name: 'Ana', quotas: 10, score: 105, daysInQueue: 5, isMe: true },
  ],
  awards: [],
  ...over,
});

export const claim = (over: Partial<Claim> = {}): Claim => ({
  id: 'c1',
  kind: 'ACIDENTE',
  status: 'EM_ANALISE',
  occurredAt: '2026-10-20T15:00:00Z',
  description: 'Caí da moto e quebrei a carenagem.',
  requestedCents: 80_000,
  approvedCents: null,
  decisionNote: null,
  createdAt: '2026-10-21T15:00:00Z',
  attachments: [],
  timeline: [
    { from: null, to: 'ENVIADA', note: null, at: '2026-10-21T15:00:00Z' },
    { from: 'ENVIADA', to: 'EM_ANALISE', note: null, at: '2026-10-22T15:00:00Z' },
  ],
  ...over,
});

/** Responde cada chamada de `api` pela tabela "MÉTODO caminho" → valor (ou função). */
export function routes(table: Record<string, unknown>) {
  (api as jest.Mock).mockImplementation(
    async (path: string, opts: { method?: string; body?: unknown } = {}) => {
      const method = opts.method ?? (opts.body ? 'POST' : 'GET');
      const hit = table[`${method} ${path}`];
      if (hit === undefined) throw new Error(`rota sem resposta no teste: ${method} ${path}`);
      return typeof hit === 'function' ? (hit as (o: unknown) => unknown)(opts) : hit;
    },
  );
}

export const calls = (method: string, path: string) =>
  (api as jest.Mock).mock.calls.filter(
    ([p, o]) =>
      p === path &&
      ((o as { method?: string })?.method ?? ((o as { body?: unknown })?.body ? 'POST' : 'GET')) ===
        method,
  );

/** Corpos enviados nas chamadas de um método e caminho, na ordem. */
export const bodies = (method: string, path: string): Record<string, unknown>[] =>
  calls(method, path).map(([, o]) => (o as { body: Record<string, unknown> }).body);
