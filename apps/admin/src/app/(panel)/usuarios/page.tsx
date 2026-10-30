import { APPEAL_WINDOW_DAYS, BLOCK_STATUS_LABEL, type BlockStatus } from '@amma/shared';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, Empty, PageTitle, Tabs } from '@/components/ui';
import { apiGet, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/labels';
import { getSession, requireSection } from '@/lib/session';

interface UserRow {
  id: string;
  name: string | null;
  phone: string | null;
  roles: string[];
  blocked: boolean;
}
interface Block {
  id: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  status: BlockStatus;
  reason: string;
  blockedById: string;
  blockedAt: string;
  appealDeadline: string;
  appealText: string | null;
  appealedAt: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  revokeReason: string | null;
  revokedAt: string | null;
}

const TABS = [
  { key: 'recursos', label: 'Recursos para decidir', status: 'EM_RECURSO' },
  { key: 'vigor', label: 'Bloqueados', status: 'ATIVO' },
  { key: 'mantidos', label: 'Mantidos', status: 'MANTIDO' },
  { key: 'revogados', label: 'Revogados', status: 'REVOGADO' },
  { key: 'buscar', label: 'Buscar pessoa', status: '' },
];

export default async function Usuarios({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; q?: string }>;
}) {
  await requireSection('usuarios');
  const me = await getSession();
  const sp = await searchParams;
  const aba = sp.q ? 'buscar' : TABS.some((t) => t.key === sp.aba) ? sp.aba! : 'recursos';
  const tab = TABS.find((t) => t.key === aba)!;
  const blocks = tab.status
    ? await apiGet<Block[]>(`/admin/blocks${qs({ status: tab.status })}`)
    : [];
  const users =
    aba === 'buscar' && sp.q ? await apiGet<UserRow[]>(`/admin/users${qs({ q: sp.q })}`) : [];

  return (
    <>
      <PageTitle title="Bloqueios e recursos">
        Todo bloqueio tem motivo, a pessoa vê o motivo e pode recorrer em até {APPEAL_WINDOW_DAYS}{' '}
        dias. Quem bloqueou não decide o recurso.
      </PageTitle>
      <Tabs
        current={aba}
        items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/usuarios?aba=${t.key}` }))}
      />

      {aba === 'buscar' && (
        <Card title="Buscar pessoa">
          <form action="/usuarios" className="row">
            <input
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="Nome ou telefone"
              aria-label="Nome ou telefone"
            />
            <button className="btn">Buscar</button>
          </form>
          {sp.q && users.length === 0 && <Empty>Ninguém encontrado.</Empty>}
          {users.map((u) => (
            <div className="item" key={u.id}>
              <div className="row">
                <h3>{u.name ?? 'Sem nome'}</h3>
                <span className="muted">{u.phone}</span>
                <span className="muted">
                  {u.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ') || 'sem perfil'}
                </span>
                {u.blocked && <Badge value="MANTIDO" label="Bloqueado" />}
              </div>
              {!u.blocked && !u.roles.includes('ADMIN') && u.id !== me.id && (
                <ActionForm
                  trigger="Bloquear"
                  tone="danger"
                  title={`Bloquear ${u.name ?? u.phone}`}
                  path={`/admin/users/${u.id}/block`}
                  fields={[
                    {
                      name: 'reason',
                      label: 'Motivo (a pessoa vê)',
                      type: 'textarea',
                      minLength: 10,
                      hint: 'Mínimo de 10 caracteres.',
                    },
                  ]}
                />
              )}
            </div>
          ))}
        </Card>
      )}

      {aba !== 'buscar' && blocks.length === 0 && <Empty>Nada por aqui.</Empty>}
      {blocks.map((b) => (
        <Card key={b.id}>
          <div className="row">
            <h2>{b.userName ?? 'Sem nome'}</h2>
            <span className="muted">{b.userPhone}</span>
            <Badge
              value={b.status === 'REVOGADO' ? 'REVOGADO' : b.status}
              label={BLOCK_STATUS_LABEL[b.status]}
            />
          </div>
          <p>
            <strong>Motivo:</strong> {b.reason}
          </p>
          <p className="muted">
            Bloqueado em {dateTime(b.blockedAt)} · pode recorrer até {dateTime(b.appealDeadline)}
          </p>
          {b.appealText && (
            <p>
              <strong>Recurso ({dateTime(b.appealedAt)}):</strong> {b.appealText}
            </p>
          )}
          {b.decisionReason && (
            <p className="muted">
              Decisão do recurso ({dateTime(b.decidedAt)}): {b.decisionReason}
            </p>
          )}
          {b.revokeReason && (
            <p className="muted">
              Revogado em {dateTime(b.revokedAt)}: {b.revokeReason}
            </p>
          )}
          <div className="row">
            {b.status === 'EM_RECURSO' &&
              (b.blockedById === me.id ? (
                <span className="muted">
                  Você aplicou este bloqueio; outro administrador deve decidir o recurso.
                </span>
              ) : (
                <ActionForm
                  trigger="Decidir recurso"
                  title="Decidir recurso"
                  path={`/admin/blocks/${b.id}/appeal-decision`}
                  fields={[
                    {
                      name: 'decision',
                      label: 'Decisão',
                      type: 'select',
                      options: [
                        { value: 'ACEITO', label: 'Aceitar (libera a conta)' },
                        { value: 'NEGADO', label: 'Negar (mantém o bloqueio)' },
                      ],
                    },
                    {
                      name: 'reason',
                      label: 'Justificativa (a pessoa vê)',
                      type: 'textarea',
                      minLength: 10,
                    },
                  ]}
                />
              ))}
            {b.status !== 'REVOGADO' && (
              <ActionForm
                trigger="Revogar bloqueio"
                tone="plain"
                title="Revogar bloqueio"
                path={`/admin/blocks/${b.id}/revoke`}
                fields={[
                  { name: 'reason', label: 'Motivo da revogação', type: 'textarea', minLength: 10 },
                ]}
              />
            )}
          </div>
        </Card>
      ))}
    </>
  );
}
