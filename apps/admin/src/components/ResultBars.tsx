import type { Proposal } from '@/lib/types';

/** Barras do resultado de uma votação encerrada (sim, não, abstenção). */
export function ResultBars({ r }: { r: NonNullable<Proposal['result']> }) {
  const parts = [
    { label: 'Sim', n: r.yes, cls: 'green' },
    { label: 'Não', n: r.no, cls: '' },
    { label: 'Abstenção', n: r.abstain, cls: '' },
  ];
  return (
    <table aria-label="Resultado da votação">
      <tbody>
        {parts.map((p) => (
          <tr key={p.label}>
            <td>{p.label}</td>
            <td style={{ width: '65%' }}>
              <div className={`bar ${p.cls}`} role="img" aria-label={`${p.n} de ${r.total} votos`}>
                <span style={{ width: `${r.total ? (p.n / r.total) * 100 : 0}%` }} />
              </div>
            </td>
            <td className="num">{p.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
