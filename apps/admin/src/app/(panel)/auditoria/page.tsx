import { auditLabel } from '@amma/shared';
import { Card, Empty, PageTitle } from '@/components/ui';
import { apiGet, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { requireSection } from '@/lib/session';

interface Entry {
  id: string;
  at: string;
  actorId: string;
  actorName: string | null;
  action: string;
  params: Record<string, string>;
  reason: string | null;
  ip: string | null;
}

export default async function Auditoria({
  searchParams,
}: {
  searchParams: Promise<{ acao?: string; de?: string; ate?: string; antes?: string }>;
}) {
  await requireSection('auditoria');
  const sp = await searchParams;
  const [log, actions] = await Promise.all([
    apiGet<{ items: Entry[]; nextCursor: string | null }>(
      `/admin/audit${qs({
        action: sp.acao,
        from: sp.de ? `${sp.de}T00:00:00-03:00` : undefined,
        to: sp.ate ? `${sp.ate}T23:59:59-03:00` : undefined,
        before: sp.antes,
        limit: 50,
      })}`,
    ),
    apiGet<string[]>('/admin/audit/actions'),
  ]);
  const more = log.nextCursor
    ? `/auditoria${qs({ acao: sp.acao, de: sp.de, ate: sp.ate, antes: log.nextCursor })}`
    : null;

  return (
    <>
      <PageTitle title="Trilha de auditoria">
        Registro de tudo que a administração alterou ou abriu de sensível. Não pode ser editado nem
        apagado.
      </PageTitle>
      <Card>
        <form action="/auditoria" className="row">
          <label>
            Ação{' '}
            <select name="acao" defaultValue={sp.acao ?? ''}>
              <option value="">Todas</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {auditLabel(a)}
                </option>
              ))}
            </select>
          </label>
          <label>
            De <input type="date" name="de" defaultValue={sp.de ?? ''} />
          </label>
          <label>
            Até <input type="date" name="ate" defaultValue={sp.ate ?? ''} />
          </label>
          <button className="btn">Filtrar</button>
        </form>
      </Card>
      <Card>
        {log.items.length === 0 ? (
          <Empty>Nenhum registro.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>O quê</th>
                <th>Registro</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {log.items.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.at)}</td>
                  <td>{e.actorName ?? e.actorId.slice(0, 8)}</td>
                  <td>{auditLabel(e.action)}</td>
                  <td className="muted">
                    {Object.values(e.params)
                      .map((v) => v.slice(0, 8))
                      .join(' · ') || '—'}
                  </td>
                  <td>{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {more && (
          <p>
            <a href={more}>Ver registros mais antigos →</a>
          </p>
        )}
      </Card>
    </>
  );
}
