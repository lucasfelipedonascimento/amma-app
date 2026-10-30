import { DOCUMENT_LABEL, type DocumentType } from '@amma/shared';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, Empty, PageTitle, Tabs } from '@/components/ui';
import { apiGet, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { APPROVAL_LABEL, VEHICLE_LABEL } from '@/lib/labels';
import { requireSection } from '@/lib/session';

interface Driver {
  userId: string;
  name: string | null;
  phone: string | null;
  blocked: boolean;
  approval: { status: string; missing: DocumentType[]; rejected: DocumentType[] };
  vehicles: { id: string; type: string; plate: string; model: string; year: number }[];
  documents: {
    id: string;
    type: DocumentType;
    vehicleId: string | null;
    status: string;
    rejectionReason: string | null;
    createdAt: string;
  }[];
}

const TABS = [
  { key: 'PENDENTE', label: 'Pendentes' },
  { key: 'REPROVADO', label: 'Reprovados' },
  { key: 'APROVADO', label: 'Aprovados' },
  { key: 'TODOS', label: 'Todos' },
];

export default async function Motoristas({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireSection('motoristas');
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? sp.status! : 'PENDENTE';
  const drivers = await apiGet<Driver[]>(
    `/admin/drivers${qs({ status: status === 'TODOS' ? undefined : status, q: sp.q })}`,
  );

  return (
    <>
      <PageTitle title="Motoristas e documentos">
        O motorista só é aprovado quando CNH, documento do veículo e foto estão aprovados.
      </PageTitle>
      <Tabs
        current={status}
        items={TABS.map((t) => ({ ...t, href: `/motoristas?status=${t.key}` }))}
      />
      {drivers.length === 0 && <Empty>Nenhum motorista nesta situação.</Empty>}
      {drivers.map((d) => (
        <Card key={d.userId}>
          <div className="row">
            <h2>{d.name ?? 'Sem nome'}</h2>
            <Badge value={d.approval.status} label={APPROVAL_LABEL[d.approval.status]} />
            {d.blocked && <Badge value="MANTIDO" label="Conta bloqueada" />}
            <span className="muted">{d.phone}</span>
            <a href={`/usuarios?q=${encodeURIComponent(d.phone ?? '')}`}>Bloqueios</a>
          </div>
          <p className="muted">
            {d.vehicles
              .map((v) => `${VEHICLE_LABEL[v.type] ?? v.type} ${v.model} ${v.year} (${v.plate})`)
              .join(' · ') || 'Sem veículo'}
          </p>
          {d.approval.missing.length > 0 && (
            <p className="muted">
              Ainda não enviou: {d.approval.missing.map((t) => DOCUMENT_LABEL[t]).join(', ')}.
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Situação</th>
                <th>Enviado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {d.documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{DOCUMENT_LABEL[doc.type]}</td>
                  <td>
                    <Badge value={doc.status} label={APPROVAL_LABEL[doc.status]} />
                    {doc.rejectionReason && <div className="muted">{doc.rejectionReason}</div>}
                  </td>
                  <td>{dateTime(doc.createdAt)}</td>
                  <td>
                    <div className="row">
                      <a
                        href={`/api/proxy/admin/documents/${doc.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir arquivo
                      </a>
                      {doc.status === 'PENDENTE' && (
                        <>
                          <ActionForm
                            trigger="Aprovar"
                            path={`/admin/documents/${doc.id}/review`}
                            fixed={{ status: 'APROVADO' }}
                            confirm="Aprovar este documento?"
                          />
                          <ActionForm
                            trigger="Reprovar"
                            tone="danger"
                            title="Reprovar documento"
                            path={`/admin/documents/${doc.id}/review`}
                            fixed={{ status: 'REPROVADO' }}
                            fields={[
                              {
                                name: 'reason',
                                label: 'Motivo (o motorista vê)',
                                type: 'textarea',
                                minLength: 5,
                              },
                            ]}
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </>
  );
}
