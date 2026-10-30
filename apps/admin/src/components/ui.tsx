import type { ReactNode } from 'react';

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-title">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

export function Card({
  title,
  children,
  wide,
}: {
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`card${wide ? ' wide' : ''}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

const TONES: Record<string, string> = {
  ok: 'ok',
  APROVADO: 'ok',
  ATIVO: 'ok',
  APROVADA: 'ok',
  PROCEDENTE: 'ok',
  REVOGADO: 'ok',
  ENCERRADO: 'muted',
  PENDENTE: 'warn',
  EM_ANALISE: 'warn',
  EM_RECURSO: 'warn',
  ABERTA: 'warn',
  ABERTO: 'bad',
  EM_ATENDIMENTO: 'warn',
  SUSPENSO: 'warn',
  REPROVADO: 'bad',
  RECUSADO: 'bad',
  REMOVIDO: 'bad',
  MANTIDO: 'bad',
  REJEITADA: 'bad',
  SEM_QUORUM: 'muted',
  IMPROCEDENTE: 'muted',
  ARQUIVADA: 'muted',
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`badge ${TONES[value] ?? 'muted'}`}>
      {label ?? value.replaceAll('_', ' ').toLowerCase()}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Tabs({
  items,
  current,
}: {
  items: readonly { href: string; label: string; key: string }[];
  current: string;
}) {
  return (
    <nav className="tabs" aria-label="Filtros">
      {items.map((i) => (
        <a key={i.key} href={i.href} aria-current={i.key === current ? 'page' : undefined}>
          {i.label}
        </a>
      ))}
    </nav>
  );
}
