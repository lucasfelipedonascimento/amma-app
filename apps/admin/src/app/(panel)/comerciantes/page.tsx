import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, Empty, PageTitle, Tabs } from '@/components/ui';
import { apiGet, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { APPROVAL_LABEL } from '@/lib/labels';
import { requireSection } from '@/lib/session';

interface Merchant {
  userId: string;
  tradeName: string;
  cnpj: string | null;
  address: string;
  ownerName: string | null;
  ownerPhone: string | null;
  blocked: boolean;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
}

const TABS = [
  { key: 'PENDENTE', label: 'Pendentes' },
  { key: 'REPROVADO', label: 'Recusados' },
  { key: 'APROVADO', label: 'Aprovados' },
  { key: 'TODOS', label: 'Todos' },
];

export default async function Comerciantes({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireSection('comerciantes');
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? sp.status! : 'PENDENTE';
  const list = await apiGet<Merchant[]>(
    `/admin/merchants${qs({ status: status === 'TODOS' ? undefined : status })}`,
  );
  return (
    <>
      <PageTitle title="Comerciantes">Cadastros de estabelecimentos que pedem entregas.</PageTitle>
      <Tabs
        current={status}
        items={TABS.map((t) => ({ ...t, href: `/comerciantes?status=${t.key}` }))}
      />
      {list.length === 0 && <Empty>Nenhum comerciante nesta situação.</Empty>}
      {list.map((m) => (
        <Card key={m.userId}>
          <div className="row">
            <h2>{m.tradeName}</h2>
            <Badge value={m.status} label={APPROVAL_LABEL[m.status]} />
            {m.blocked && <Badge value="MANTIDO" label="Conta bloqueada" />}
          </div>
          <p>
            {m.address} · CNPJ: {m.cnpj ?? 'não informado'}
          </p>
          <p className="muted">
            Responsável: {m.ownerName ?? '—'} ({m.ownerPhone}) · cadastro em {dateTime(m.createdAt)}
          </p>
          {m.rejectionReason && <p className="muted">Motivo da recusa: {m.rejectionReason}</p>}
          <div className="row">
            {m.status !== 'APROVADO' && (
              <ActionForm
                trigger="Aprovar"
                path={`/admin/merchants/${m.userId}/review`}
                fixed={{ status: 'APROVADO' }}
                confirm={`Aprovar ${m.tradeName}?`}
              />
            )}
            {m.status !== 'REPROVADO' && (
              <ActionForm
                trigger="Recusar"
                tone="danger"
                title="Recusar cadastro"
                path={`/admin/merchants/${m.userId}/review`}
                fixed={{ status: 'REPROVADO' }}
                fields={[{ name: 'reason', label: 'Motivo', type: 'textarea', minLength: 5 }]}
              />
            )}
            <a href={`/usuarios?q=${encodeURIComponent(m.ownerPhone ?? '')}`}>Bloqueios</a>
          </div>
        </Card>
      ))}
    </>
  );
}
