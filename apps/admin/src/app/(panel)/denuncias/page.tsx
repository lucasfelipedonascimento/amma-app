import { REPORT_CATEGORY_LABEL, type ReportCategory } from '@amma/shared';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, Empty, PageTitle, Tabs } from '@/components/ui';
import { apiGet, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { EMERGENCY_STATUS_LABEL, REPORT_STATUS_LABEL } from '@/lib/labels';
import { requireSection } from '@/lib/session';

interface Report {
  id: string;
  category: ReportCategory;
  description: string;
  status: string;
  severe: boolean;
  resolution: string | null;
  reportedId: string | null;
  deliveryId: string | null;
  createdAt: string;
  reporter: { name: string | null; phone: string | null };
  reported: { name: string | null; phone: string | null } | null;
}
interface Alert {
  id: string;
  actorRole: string;
  deliveryId: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  status: string;
  handledNote: string | null;
  createdAt: string;
  user: { name: string | null; phone: string | null };
}

const TABS = [
  { key: 'ABERTA', label: 'Abertas' },
  { key: 'EM_ANALISE', label: 'Em análise' },
  { key: 'PROCEDENTE', label: 'Procedentes' },
  { key: 'IMPROCEDENTE', label: 'Improcedentes' },
  { key: 'ARQUIVADA', label: 'Arquivadas' },
];

export default async function Denuncias({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireSection('denuncias');
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? sp.status! : 'ABERTA';
  const [reports, alerts] = await Promise.all([
    apiGet<Report[]>(`/admin/safety/reports${qs({ status })}`),
    apiGet<Alert[]>('/admin/safety/alerts?status=ABERTO'),
  ]);
  const inService = await apiGet<Alert[]>('/admin/safety/alerts?status=EM_ATENDIMENTO');

  return (
    <>
      <PageTitle title="Denúncias e alertas">
        As graves aparecem primeiro. A resposta é vista por quem denunciou.
      </PageTitle>

      <Card title={`Alertas de emergência (${alerts.length + inService.length} em aberto)`}>
        {alerts.length + inService.length === 0 && <Empty>Nenhum alerta em aberto.</Empty>}
        {[...alerts, ...inService].map((a) => (
          <div className="item" key={a.id}>
            <div className="row">
              <h3>
                {a.user.name ?? 'Alguém'} ({a.actorRole.toLowerCase()}) — {a.user.phone}
              </h3>
              <Badge value={a.status} label={EMERGENCY_STATUS_LABEL[a.status]} />
            </div>
            <p className="muted">
              {dateTime(a.createdAt)}
              {a.lat != null && a.lng != null && (
                <>
                  {' · '}
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=17/${a.lat}/${a.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ver no mapa
                  </a>
                </>
              )}
            </p>
            {a.note && <p>{a.note}</p>}
            <div className="row">
              {a.status === 'ABERTO' && (
                <ActionForm
                  trigger="Assumir"
                  method="PATCH"
                  path={`/admin/safety/alerts/${a.id}`}
                  fixed={{ status: 'EM_ATENDIMENTO' }}
                  confirm="Assumir o atendimento deste alerta?"
                />
              )}
              <ActionForm
                trigger="Encerrar"
                tone="plain"
                method="PATCH"
                title="Encerrar alerta"
                path={`/admin/safety/alerts/${a.id}`}
                fixed={{ status: 'ENCERRADO' }}
                fields={[
                  { name: 'note', label: 'O que foi feito', type: 'textarea', minLength: 5 },
                ]}
              />
            </div>
          </div>
        ))}
      </Card>

      <Tabs
        current={status}
        items={TABS.map((t) => ({ ...t, href: `/denuncias?status=${t.key}` }))}
      />
      {reports.length === 0 && <Empty>Nenhuma denúncia nesta situação.</Empty>}
      {reports.map((r) => (
        <Card key={r.id}>
          <div className="row">
            <h2>{REPORT_CATEGORY_LABEL[r.category] ?? r.category}</h2>
            <Badge value={r.status} label={REPORT_STATUS_LABEL[r.status]} />
            {r.severe && <Badge value="ABERTO" label="grave" />}
          </div>
          <p>{r.description}</p>
          <p className="muted">
            Denunciante: {r.reporter.name ?? '—'} ({r.reporter.phone}) · Denunciado:{' '}
            {r.reported ? `${r.reported.name ?? '—'} (${r.reported.phone})` : 'não identificado'} ·{' '}
            {dateTime(r.createdAt)}
          </p>
          {r.resolution && <p className="muted">Resposta: {r.resolution}</p>}
          <div className="row">
            {(['EM_ANALISE', 'PROCEDENTE', 'IMPROCEDENTE', 'ARQUIVADA'] as const)
              .filter((s) => s !== r.status)
              .map((s) => (
                <ActionForm
                  key={s}
                  trigger={REPORT_STATUS_LABEL[s]}
                  tone={s === 'PROCEDENTE' ? 'primary' : 'plain'}
                  method="PATCH"
                  title={`Marcar como ${REPORT_STATUS_LABEL[s].toLowerCase()}`}
                  path={`/admin/safety/reports/${r.id}`}
                  fixed={{ status: s }}
                  fields={[
                    {
                      name: 'resolution',
                      label: 'Resposta para quem denunciou',
                      type: 'textarea',
                      required: false,
                    },
                  ]}
                />
              ))}
            {r.reported && r.reportedId && (
              <a href={`/usuarios?q=${encodeURIComponent(r.reported.phone ?? '')}`}>
                Bloquear denunciado…
              </a>
            )}
          </div>
        </Card>
      ))}
    </>
  );
}
