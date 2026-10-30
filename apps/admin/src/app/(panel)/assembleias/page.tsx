import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, Empty, PageTitle, Tabs } from '@/components/ui';
import { ResultBars } from '@/components/ResultBars';
import type { Proposal } from '@/lib/types';
import { apiGet, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { PROPOSAL_KIND_LABEL, PROPOSAL_STATUS_LABEL } from '@/lib/labels';
import { isAdmin, requireSection } from '@/lib/session';

const TABS = [
  { key: 'todas', label: 'Todas' },
  { key: 'abertas', label: 'Em votação' },
  { key: 'encerradas', label: 'Encerradas' },
];

export default async function Assembleias({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const session = await requireSection('assembleias');
  const { filtro } = await searchParams;
  const current = TABS.some((t) => t.key === filtro) ? filtro! : 'todas';
  const list = await apiGet<Proposal[]>(
    `/panel/assembly/proposals${qs({ filter: current === 'todas' ? undefined : current })}`,
  );

  return (
    <>
      <PageTitle title="Assembleias">
        Cada sócio tem um voto. O resultado só aparece depois do encerramento.
      </PageTitle>
      {isAdmin(session) && (
        <Card title="Nova proposta">
          <ActionForm
            trigger="Abrir proposta"
            title="Abrir proposta"
            path="/admin/assembly/proposals"
            fixed={{ kind: 'GERAL' }}
            fields={[
              { name: 'title', label: 'Título', type: 'text', minLength: 5 },
              { name: 'description', label: 'Descrição', type: 'textarea', minLength: 10 },
              {
                name: 'closesAt',
                label: 'Encerra em',
                type: 'datetime',
                hint: 'Entre 24 horas e 60 dias a partir de agora.',
              },
              {
                name: 'quorumPercent',
                label: 'Quórum (%)',
                type: 'number',
                min: 0,
                max: 100,
                required: false,
                hint: 'Opcional.',
              },
            ]}
          />
          <small className="muted">
            Propostas que mudam as regras da compra coletiva são abertas pela API (campo
            ruleChange).
          </small>
        </Card>
      )}
      <Tabs
        current={current}
        items={TABS.map((t) => ({ ...t, href: `/assembleias?filtro=${t.key}` }))}
      />
      {list.length === 0 && <Empty>Nenhuma proposta.</Empty>}
      {list.map((p) => (
        <Card key={p.id}>
          <div className="row">
            <h2>
              <a href={`/assembleias/${p.id}`}>{p.title}</a>
            </h2>
            <Badge value={p.status} label={PROPOSAL_STATUS_LABEL[p.status]} />
            <span className="muted">{PROPOSAL_KIND_LABEL[p.kind] ?? p.kind}</span>
          </div>
          <p className="muted">
            {p.status === 'ABERTA'
              ? `Encerra em ${dateTime(p.closesAt)}`
              : `Encerrada em ${dateTime(p.result?.closedAt)}`}{' '}
            · quórum {p.quorumPercent}% ({p.requiredVotes} de {p.eligibleCount} sócios)
          </p>
          {p.result && <ResultBars r={p.result} />}
        </Card>
      ))}
    </>
  );
}
