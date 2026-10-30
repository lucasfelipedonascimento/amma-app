import { formatBRL } from '@amma/shared';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, Empty, PageTitle } from '@/components/ui';
import { apiGet } from '@/lib/api';
import type { Group } from '@/lib/types';
import { VEHICLE_LABEL } from '@/lib/labels';
import { isAdmin, requireSection } from '@/lib/session';

export default async function CompraColetiva() {
  const session = await requireSection('compra-coletiva');
  const groups = await apiGet<Group[]>('/panel/purchase-groups');
  return (
    <>
      <PageTitle title="Compra coletiva">
        Fila por cotas e tempo na fila. O dinheiro fica com o parceiro regulado; aqui há só o
        registro dos aportes.
      </PageTitle>
      {isAdmin(session) && (
        <Card title="Novo grupo">
          <ActionForm
            trigger="Criar grupo"
            title="Criar grupo de compra"
            path="/admin/purchase-groups"
            fields={[
              { name: 'name', label: 'Nome', type: 'text', minLength: 3 },
              { name: 'description', label: 'Descrição', type: 'textarea', required: false },
              {
                name: 'vehicleType',
                label: 'Veículo',
                type: 'select',
                options: [
                  { value: 'MOTO', label: 'Moto' },
                  { value: 'CARRO', label: 'Carro' },
                ],
              },
              { name: 'targetCents', label: 'Preço de um veículo', type: 'money' },
            ]}
          />
        </Card>
      )}
      {groups.length === 0 && <Empty>Nenhum grupo criado.</Empty>}
      {groups.map((g) => {
        const pct = Math.min(100, Math.round((g.fundedCents / g.targetCents) * 100));
        return (
          <Card key={g.id}>
            <div className="row">
              <h2>
                <a href={`/compra-coletiva/${g.id}`}>{g.name}</a>
              </h2>
              <Badge
                value={g.status === 'ABERTO' ? 'ATIVO' : 'ENCERRADO'}
                label={g.status === 'ABERTO' ? 'Aberto' : 'Encerrado'}
              />
              <span className="muted">{VEHICLE_LABEL[g.vehicleType] ?? g.vehicleType}</span>
            </div>
            <p>
              {formatBRL(g.fundedCents)} aportados de {formatBRL(g.targetCents)} por veículo ·{' '}
              {g.queueSize} na fila
            </p>
            <div className="bar" role="img" aria-label={`${pct}% do valor de um veículo`}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </Card>
        );
      })}
    </>
  );
}
