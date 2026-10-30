import { formatBRL } from '@amma/shared';
import { Card, Empty, PageTitle, Stat, Tabs } from '@/components/ui';
import { apiGet, qs } from '@/lib/api';
import { brl, percent, stars } from '@/lib/format';
import { LEVEL_LABEL } from '@/lib/labels';
import { getSession, isAdmin } from '@/lib/session';

interface Trips {
  total: number;
  concluded: number;
  cancelled: number;
  inProgress: number;
  completionRate: number | null;
}
interface Rating {
  count: number;
  average: number | null;
  distribution: number[];
}
interface Overview {
  periodDays: number;
  orders: Trips;
  rides: Trips;
  earnings: {
    workers: number;
    trips: number;
    grossCents: number;
    netCents: number;
    avgNetPerWorkerCents: number | null;
    avgNetPerTripCents: number | null;
  };
  association: {
    members: number;
    totalQuotas: number;
    levels: Record<string, number>;
    quotaFundCents: number;
    groupFundCents: number;
    platformRevenueCents: number;
  };
  satisfaction: { clientRatesDriver: Rating; driverRatesClient: Rating };
  pointSatisfaction: { count: number; average: number | null };
  queues: Record<string, number>;
}

const PERIODS = [7, 30, 90] as const;

const QUEUE_LINKS: { key: string; label: string; href: string }[] = [
  { key: 'documents', label: 'Documentos para revisar', href: '/motoristas' },
  { key: 'merchants', label: 'Comerciantes para revisar', href: '/comerciantes' },
  { key: 'points', label: 'Pontos de acolhida em análise', href: '/acolhida' },
  { key: 'pointReports', label: 'Denúncias de pontos', href: '/acolhida' },
  { key: 'reports', label: 'Denúncias de corridas', href: '/denuncias' },
  { key: 'alerts', label: 'Alertas de emergência', href: '/denuncias' },
  { key: 'appeals', label: 'Recursos de bloqueio', href: '/usuarios?aba=recursos' },
];

function TripCard({ title, t }: { title: string; t: Trips }) {
  return (
    <Card title={title}>
      <Stat label="Pedidos no período" value={t.total} />
      <div className="row">
        <Stat label="Concluídos" value={t.concluded} />
        <Stat label="Cancelados" value={t.cancelled} />
        <Stat label="Em andamento" value={t.inProgress} />
      </div>
      <small className="muted">Taxa de conclusão: {percent(t.completionRate)}</small>
    </Card>
  );
}

function RatingBars({ title, r }: { title: string; r: Rating }) {
  const max = Math.max(1, ...r.distribution);
  return (
    <div>
      <Stat label={title} value={stars(r.average)} hint={`${r.count} avaliações`} />
      {r.count > 0 && (
        <table aria-label={`Notas: ${title}`}>
          <tbody>
            {[5, 4, 3, 2, 1].map((n) => (
              <tr key={n}>
                <td>{n} ★</td>
                <td style={{ width: '70%' }}>
                  <div
                    className="bar"
                    role="img"
                    aria-label={`${r.distribution[n - 1]} notas ${n}`}
                  >
                    <span style={{ width: `${(r.distribution[n - 1] / max) * 100}%` }} />
                  </div>
                </td>
                <td className="num">{r.distribution[n - 1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const session = await getSession();
  if (!isAdmin(session)) return <PartnerHome />;

  const { dias } = await searchParams;
  const days = PERIODS.find((p) => String(p) === dias) ?? 30;
  const o = await apiGet<Overview>(`/admin/overview${qs({ days })}`);
  const waiting = QUEUE_LINKS.filter((q) => (o.queues[q.key] ?? 0) > 0);

  return (
    <>
      <PageTitle title="Painel">Últimos {days} dias.</PageTitle>
      <Tabs
        current={String(days)}
        items={PERIODS.map((p) => ({ key: String(p), label: `${p} dias`, href: `/?dias=${p}` }))}
      />

      <Card title="Esperando alguém da associação">
        {waiting.length === 0 ? (
          <Empty>Nada na fila. 🎉</Empty>
        ) : (
          <ul>
            {waiting.map((q) => (
              <li key={q.key}>
                <a href={q.href}>{q.label}</a>: <strong>{o.queues[q.key]}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid">
        <TripCard title="Entregas" t={o.orders} />
        <TripCard title="Corridas de passageiro" t={o.rides} />
        <Card title="Ganhos dos trabalhadores">
          <Stat
            label="Ganho médio por trabalhador"
            value={brl(o.earnings.avgNetPerWorkerCents)}
            hint={`${o.earnings.workers} trabalhadores · ${o.earnings.trips} corridas concluídas`}
          />
          <Stat label="Ganho médio por corrida" value={brl(o.earnings.avgNetPerTripCents)} />
          <small className="muted">
            Valor líquido (depois da taxa base e da taxa de associação). Total pago:{' '}
            {brl(o.earnings.netCents)} de {brl(o.earnings.grossCents)} movimentados.
          </small>
        </Card>
      </div>

      <div className="grid">
        <Card title="Cotas e fundo">
          <Stat
            label="Sócios"
            value={o.association.members}
            hint={`${o.association.totalQuotas} cotas`}
          />
          <Stat
            label="Fundo de cotas (registro contábil)"
            value={formatBRL(o.association.quotaFundCents)}
          />
          <Stat
            label="Aportes de compra coletiva (no parceiro)"
            value={formatBRL(o.association.groupFundCents)}
          />
          <Stat
            label="Receita da taxa base (desde sempre)"
            value={formatBRL(o.association.platformRevenueCents)}
          />
          <small className="muted">
            {Object.entries(o.association.levels)
              .map(([k, v]) => `${LEVEL_LABEL[k] ?? k}: ${v}`)
              .join(' · ')}
          </small>
        </Card>
        <Card title="Satisfação" wide>
          <div className="grid">
            <RatingBars
              title="Clientes avaliando motoristas"
              r={o.satisfaction.clientRatesDriver}
            />
            <RatingBars
              title="Motoristas avaliando passageiros"
              r={o.satisfaction.driverRatesClient}
            />
            <Stat
              label="Motoristas avaliando pontos de acolhida"
              value={stars(o.pointSatisfaction.average)}
              hint={`${o.pointSatisfaction.count} avaliações`}
            />
          </div>
        </Card>
      </div>
    </>
  );
}

/** Sócio: sem números operacionais; vê o que a associação abre a todos (assembleias, fila, orçamento). */
async function PartnerHome() {
  const [open, groups, budget] = await Promise.all([
    apiGet<{ id: string; title: string; closesAt: string }[]>(
      '/panel/assembly/proposals?filter=abertas',
    ),
    apiGet<{ id: string; name: string; status: string }[]>('/panel/purchase-groups'),
    apiGet<{
      year: number;
      summary: { revenueCents: number; expenseCents: number; balanceCents: number };
    }>('/panel/budget'),
  ]);
  return (
    <>
      <PageTitle title="Painel do sócio">
        Transparência da associação. Você só consulta; para votar, use o aplicativo.
      </PageTitle>
      <div className="grid">
        <Card title="Votações abertas">
          <Stat label="Propostas em votação" value={open.length} />
          <a href="/assembleias">Ver assembleias</a>
        </Card>
        <Card title="Compra coletiva">
          <Stat
            label="Grupos"
            value={groups.length}
            hint={`${groups.filter((g) => g.status === 'ABERTO').length} abertos`}
          />
          <a href="/compra-coletiva">Ver fila</a>
        </Card>
        <Card title={`Orçamento ${budget.year}`}>
          <Stat label="Receitas" value={brl(budget.summary.revenueCents)} />
          <Stat label="Despesas" value={brl(budget.summary.expenseCents)} />
          <Stat label="Saldo" value={brl(budget.summary.balanceCents)} />
          <a href="/orcamento">Ver detalhes</a>
        </Card>
      </div>
    </>
  );
}
