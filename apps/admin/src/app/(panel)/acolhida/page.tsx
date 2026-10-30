import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, Empty, PageTitle, Tabs } from '@/components/ui';
import { apiGet, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { POINT_STATUS_LABEL, POINT_TYPE_LABEL } from '@/lib/labels';
import { requireSection } from '@/lib/session';

interface Point {
  id: string;
  type: string;
  status: string;
  name: string;
  neighborhood: string;
  statusNote: string | null;
  createdAt: string;
  owner: { id: string; name: string | null; phone: string | null };
  openReports: number;
}
interface PointReport {
  id: string;
  category: string;
  text: string | null;
  severe: boolean;
  createdAt: string;
  point: { id: string; name: string; status: string };
  reporter: { name: string | null };
}

const TABS = ['EM_ANALISE', 'ATIVO', 'SUSPENSO', 'RECUSADO', 'REMOVIDO'];
const note = {
  name: 'note',
  label: 'Motivo (fica registrado)',
  type: 'textarea',
  minLength: 5,
} as const;

export default async function Acolhida({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireSection('acolhida');
  const sp = await searchParams;
  const status = TABS.includes(sp.status ?? '') ? sp.status! : 'EM_ANALISE';
  const [points, reports] = await Promise.all([
    apiGet<Point[]>(`/admin/welcome-points${qs({ status })}`),
    apiGet<PointReport[]>('/admin/welcome-reports'),
  ]);

  return (
    <>
      <PageTitle title="Pontos de acolhida">
        Casas parceiras só são aprovadas depois de conferir a identidade e o local.
      </PageTitle>

      {reports.length > 0 && (
        <Card title={`Denúncias abertas (${reports.length})`}>
          {reports.map((r) => (
            <div className="item" key={r.id}>
              <div className="row">
                <h3>{r.point.name}</h3>
                <Badge value={r.point.status} label={POINT_STATUS_LABEL[r.point.status]} />
                {r.severe && <Badge value="ABERTO" label="grave" />}
              </div>
              <p>
                {r.category.replaceAll('_', ' ').toLowerCase()} — {r.text ?? 'sem texto'}
              </p>
              <p className="muted">
                Por {r.reporter.name ?? 'alguém'} em {dateTime(r.createdAt)}
              </p>
              <ActionForm
                trigger="Resolver"
                title="Resolver denúncia"
                path={`/admin/welcome-reports/${r.id}/resolve`}
                fields={[
                  {
                    name: 'outcome',
                    label: 'Resultado',
                    type: 'select',
                    options: [
                      { value: 'PROCEDENTE', label: 'Procedente' },
                      { value: 'IMPROCEDENTE', label: 'Improcedente' },
                    ],
                  },
                  {
                    name: 'response',
                    label: 'Resposta a quem denunciou',
                    type: 'textarea',
                    minLength: 5,
                  },
                  { name: 'removePoint', label: 'Remover também o ponto', type: 'checkbox' },
                ]}
              />
            </div>
          ))}
        </Card>
      )}

      <Tabs
        current={status}
        items={TABS.map((s) => ({
          key: s,
          label: POINT_STATUS_LABEL[s],
          href: `/acolhida?status=${s}`,
        }))}
      />
      {points.length === 0 && <Empty>Nenhum ponto nesta situação.</Empty>}
      {points.map((p) => (
        <Card key={p.id}>
          <div className="row">
            <h2>{p.name}</h2>
            <Badge value={p.status} label={POINT_STATUS_LABEL[p.status]} />
            <span className="muted">{POINT_TYPE_LABEL[p.type] ?? p.type}</span>
            {p.openReports > 0 && <Badge value="ABERTA" label={`${p.openReports} denúncia(s)`} />}
          </div>
          <p>
            {p.neighborhood} · cadastrado por {p.owner.name ?? '—'} ({p.owner.phone}) em{' '}
            {dateTime(p.createdAt)}
          </p>
          {p.statusNote && <p className="muted">Último motivo: {p.statusNote}</p>}
          <div className="row">
            {p.status === 'EM_ANALISE' && (
              <>
                <ActionForm
                  trigger="Aprovar"
                  title="Aprovar ponto"
                  path={`/admin/welcome-points/${p.id}/approve`}
                  fields={[
                    {
                      name: 'identityChecked',
                      label: 'Identidade do anfitrião conferida',
                      type: 'checkbox',
                    },
                    { name: 'placeChecked', label: 'Local conferido', type: 'checkbox' },
                    { name: 'note', label: 'Observação', type: 'text', required: false },
                  ]}
                />
                <ActionForm
                  trigger="Recusar"
                  tone="danger"
                  title="Recusar ponto"
                  path={`/admin/welcome-points/${p.id}/refuse`}
                  fields={[note]}
                />
              </>
            )}
            {p.status === 'SUSPENSO' && (
              <ActionForm
                trigger="Reativar"
                title="Reativar ponto"
                path={`/admin/welcome-points/${p.id}/reinstate`}
                fields={[note]}
              />
            )}
            {['EM_ANALISE', 'ATIVO', 'SUSPENSO'].includes(p.status) && (
              <ActionForm
                trigger="Remover"
                tone="danger"
                title="Remover ponto"
                path={`/admin/welcome-points/${p.id}/remove`}
                fields={[note]}
              />
            )}
          </div>
        </Card>
      ))}
    </>
  );
}
