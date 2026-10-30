import {
  BUDGET_CATEGORY_LABEL,
  EXPENSE_CATEGORIES,
  REVENUE_CATEGORIES,
  type BudgetCategory,
} from '@amma/shared';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, Empty, PageTitle, Stat } from '@/components/ui';
import { apiGet, qs } from '@/lib/api';
import { brl, dateOnly, monthLabel } from '@/lib/format';
import { isAdmin, requireSection } from '@/lib/session';

interface Entry {
  id: string;
  kind: 'RECEITA' | 'DESPESA';
  category: BudgetCategory;
  description: string;
  amountCents: number;
  occurredOn: string;
  receiptRef: string | null;
  isReversal: boolean;
  reversed: boolean;
  createdByName?: string | null;
}
interface Budget {
  year: number;
  summary: {
    revenueCents: number;
    expenseCents: number;
    balanceCents: number;
    byCategory: { kind: string; category: BudgetCategory; totalCents: number }[];
    byMonth: { month: string; revenueCents: number; expenseCents: number }[];
  };
  entries: Entry[];
  note: string;
}

const label = (c: string) => BUDGET_CATEGORY_LABEL[c as BudgetCategory] ?? c;

export default async function Orcamento({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const session = await requireSection('orcamento');
  const { ano } = await searchParams;
  const year = Number(ano) >= 2020 ? Number(ano) : new Date().getUTCFullYear();
  const b = await apiGet<Budget>(`/panel/budget${qs({ year })}`);
  const admin = isAdmin(session);
  const maxMonth = Math.max(
    1,
    ...b.summary.byMonth.flatMap((m) => [m.revenueCents, m.expenseCents]),
  );

  return (
    <>
      <PageTitle title={`Orçamento aberto — ${b.year}`}>
        Receitas e despesas da associação, visíveis a todos os sócios. {b.note}
      </PageTitle>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <a href={`/orcamento?ano=${year - 1}`}>← {year - 1}</a>
        {year < new Date().getUTCFullYear() && (
          <a href={`/orcamento?ano=${year + 1}`}>{year + 1} →</a>
        )}
      </div>

      <div className="grid">
        <Card>
          <Stat label="Receitas" value={brl(b.summary.revenueCents)} />
        </Card>
        <Card>
          <Stat label="Despesas" value={brl(b.summary.expenseCents)} />
        </Card>
        <Card>
          <Stat label="Saldo" value={brl(b.summary.balanceCents)} />
        </Card>
      </div>

      <div className="grid">
        <Card title="Por categoria">
          {b.summary.byCategory.length === 0 ? (
            <Empty>Sem lançamentos neste ano.</Empty>
          ) : (
            <table>
              <tbody>
                {b.summary.byCategory.map((c) => (
                  <tr key={`${c.kind}${c.category}`}>
                    <td>{label(c.category)}</td>
                    <td>
                      <Badge
                        value={c.kind === 'RECEITA' ? 'ok' : 'muted'}
                        label={c.kind === 'RECEITA' ? 'receita' : 'despesa'}
                      />
                    </td>
                    <td className="num">{brl(c.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Por mês">
          {b.summary.byMonth.length === 0 ? (
            <Empty>Sem lançamentos neste ano.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th>Receitas × despesas</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {b.summary.byMonth.map((m) => (
                  <tr key={m.month}>
                    <td>{monthLabel(m.month)}</td>
                    <td style={{ width: '50%' }}>
                      <div
                        className="bar green"
                        role="img"
                        aria-label={`Receitas ${brl(m.revenueCents)}`}
                      >
                        <span style={{ width: `${(m.revenueCents / maxMonth) * 100}%` }} />
                      </div>
                      <div
                        className="bar"
                        role="img"
                        aria-label={`Despesas ${brl(m.expenseCents)}`}
                        style={{ marginTop: 3 }}
                      >
                        <span style={{ width: `${(m.expenseCents / maxMonth) * 100}%` }} />
                      </div>
                    </td>
                    <td className="num">{brl(m.revenueCents - m.expenseCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {admin && (
        <Card title="Novo lançamento">
          <div className="row">
            <ActionForm
              trigger="Lançar despesa"
              title="Lançar despesa"
              tone="danger"
              path="/admin/budget/entries"
              fixed={{ kind: 'DESPESA' }}
              fields={[
                {
                  name: 'category',
                  label: 'Categoria',
                  type: 'select',
                  options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: label(c) })),
                },
                {
                  name: 'description',
                  label: 'Descrição (todos os sócios veem)',
                  type: 'text',
                  minLength: 5,
                },
                { name: 'amountCents', label: 'Valor', type: 'money' },
                { name: 'occurredOn', label: 'Data', type: 'date' },
                { name: 'receiptRef', label: 'Nº do comprovante', type: 'text', required: false },
              ]}
            />
            <ActionForm
              trigger="Lançar outra receita"
              title="Lançar receita"
              path="/admin/budget/entries"
              fixed={{ kind: 'RECEITA' }}
              fields={[
                {
                  name: 'category',
                  label: 'Categoria',
                  type: 'select',
                  options: REVENUE_CATEGORIES.map((c) => ({ value: c, label: label(c) })),
                },
                {
                  name: 'description',
                  label: 'Descrição (todos os sócios veem)',
                  type: 'text',
                  minLength: 5,
                },
                { name: 'amountCents', label: 'Valor', type: 'money' },
                { name: 'occurredOn', label: 'Data', type: 'date' },
                { name: 'receiptRef', label: 'Nº do comprovante', type: 'text', required: false },
              ]}
            />
          </div>
          <small className="muted">
            Lançamentos não são editados nem apagados; um erro se corrige com estorno. A taxa base
            entra sozinha, do livro-razão.
          </small>
        </Card>
      )}

      <Card title="Lançamentos">
        {b.entries.length === 0 ? (
          <Empty>Nenhum lançamento manual neste ano.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Categoria</th>
                <th>Descrição</th>
                <th className="num">Valor</th>
                {admin && <th>Ação</th>}
              </tr>
            </thead>
            <tbody>
              {b.entries.map((e) => (
                <tr key={e.id} style={e.reversed || e.isReversal ? { opacity: 0.6 } : undefined}>
                  <td>{dateOnly(e.occurredOn)}</td>
                  <td>{label(e.category)}</td>
                  <td>
                    {e.description}
                    {e.receiptRef && <span className="muted"> · comprovante {e.receiptRef}</span>}
                    {e.reversed && (
                      <>
                        {' '}
                        <Badge value="REPROVADO" label="estornado" />
                      </>
                    )}
                    {e.isReversal && (
                      <>
                        {' '}
                        <Badge value="muted" label="estorno" />
                      </>
                    )}
                  </td>
                  <td className="num">
                    {e.kind === 'DESPESA' ? '−' : '+'} {brl(e.amountCents)}
                  </td>
                  {admin && (
                    <td>
                      {!e.reversed && !e.isReversal && (
                        <ActionForm
                          trigger="Estornar"
                          tone="plain"
                          title="Estornar lançamento"
                          path={`/admin/budget/entries/${e.id}/reverse`}
                          fields={[
                            {
                              name: 'reason',
                              label: 'Motivo do estorno',
                              type: 'text',
                              minLength: 5,
                            },
                          ]}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
