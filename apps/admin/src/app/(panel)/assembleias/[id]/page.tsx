import { Badge, Card, PageTitle } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { PROPOSAL_KIND_LABEL, PROPOSAL_STATUS_LABEL } from '@/lib/labels';
import { requireSection } from '@/lib/session';
import { ResultBars } from '@/components/ResultBars';
import type { Proposal } from '@/lib/types';

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection('assembleias');
  const { id } = await params;
  const p = await apiGet<Proposal>(`/panel/assembly/proposals/${id}`);
  return (
    <>
      <PageTitle title={p.title}>
        <a href="/assembleias">← Assembleias</a>
      </PageTitle>
      <Card>
        <div className="row">
          <Badge value={p.status} label={PROPOSAL_STATUS_LABEL[p.status]} />
          <span className="muted">{PROPOSAL_KIND_LABEL[p.kind] ?? p.kind}</span>
        </div>
        <p style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p>
        {p.ruleChange != null && <pre>{JSON.stringify(p.ruleChange, null, 2)}</pre>}
        <p className="muted">
          Aberta em {dateTime(p.opensAt)} · encerra em {dateTime(p.closesAt)} · quórum{' '}
          {p.quorumPercent}% ({p.requiredVotes} de {p.eligibleCount} sócios aptos)
        </p>
      </Card>
      {p.result ? (
        <Card title="Resultado">
          <ResultBars r={p.result} />
          <p className="muted">
            Total de votos: {p.result.total}. Fechada em {dateTime(p.result.closedAt)}. Selo de
            conferência da apuração: <code>{p.result.ballotDigest}</code>
          </p>
        </Card>
      ) : (
        <Card>
          <p className="muted">A contagem só é divulgada depois do encerramento da votação.</p>
        </Card>
      )}
    </>
  );
}
