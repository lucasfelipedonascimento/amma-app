import { formatBRL } from '@amma/shared';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, Empty, PageTitle } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { isAdmin, requireSection } from '@/lib/session';

interface Detail {
  id: string;
  name: string;
  description: string | null;
  vehicleType: string;
  targetCents: number;
  status: string;
  fundedCents: number;
  availableUnits: number;
  rules: Record<string, unknown>;
  queue: { position: number; name: string; quotas: number; score: number; daysInQueue: number }[];
  awards: { position: number; name: string; awardedAt: string }[];
}

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSection('compra-coletiva');
  const { id } = await params;
  const g = await apiGet<Detail>(`/panel/purchase-groups/${id}`);
  const admin = isAdmin(session);
  return (
    <>
      <PageTitle title={g.name}>
        <a href="/compra-coletiva">← Compra coletiva</a>
      </PageTitle>
      <Card>
        <div className="row">
          <Badge
            value={g.status === 'ABERTO' ? 'ATIVO' : 'ENCERRADO'}
            label={g.status === 'ABERTO' ? 'Aberto' : 'Encerrado'}
          />
          <span>
            {formatBRL(g.fundedCents)} de {formatBRL(g.targetCents)} por veículo · contemplações
            possíveis agora: <strong>{g.availableUnits}</strong>
          </span>
        </div>
        {g.description && <p>{g.description}</p>}
        <p className="muted">Regras vigentes da fila: {JSON.stringify(g.rules)}</p>
        {admin && g.status === 'ABERTO' && (
          <div className="row">
            <ActionForm
              trigger="Contemplar o 1º da fila"
              path={`/admin/purchase-groups/${g.id}/award`}
              confirm="Contemplar o primeiro da fila com o saldo disponível?"
            />
            <ActionForm
              trigger="Encerrar grupo"
              tone="danger"
              path={`/admin/purchase-groups/${g.id}/close`}
              confirm="Encerrar este grupo?"
            />
          </div>
        )}
      </Card>
      <Card title="Fila">
        {g.queue.length === 0 ? (
          <Empty>Ninguém na fila.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Sócio</th>
                <th className="num">Cotas</th>
                <th className="num">Dias na fila</th>
                <th className="num">Pontos</th>
              </tr>
            </thead>
            <tbody>
              {g.queue.map((q) => (
                <tr key={q.position}>
                  <td>{q.position}</td>
                  <td>{q.name}</td>
                  <td className="num">{q.quotas}</td>
                  <td className="num">{q.daysInQueue}</td>
                  <td className="num">{q.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Contemplados">
        {g.awards.length === 0 ? (
          <Empty>Ninguém contemplado ainda.</Empty>
        ) : (
          <ul>
            {g.awards.map((a) => (
              <li key={a.position}>
                {a.position}º — {a.name} em {dateTime(a.awardedAt)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
