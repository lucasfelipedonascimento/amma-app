import { SECTION_LABEL, sectionsFor, type PanelRole } from '@amma/shared';
import { LogoutButton } from './LogoutButton';

/** Menu só com as áreas que a pessoa pode abrir (a API confere de novo em cada rota). */
export function Nav({ name, roles }: { name: string | null; roles: PanelRole[] }) {
  return (
    <aside className="side">
      <div className="brand">AMMA</div>
      <nav aria-label="Áreas do painel">
        {sectionsFor(roles).map((s) => (
          <a key={s} href={s === 'painel' ? '/' : `/${s}`}>
            {SECTION_LABEL[s]}
          </a>
        ))}
      </nav>
      <div className="who">
        <span>{name ?? 'Sem nome'}</span>
        <small>{roles.includes('ADMIN') ? 'Administração' : 'Sócio (somente leitura)'}</small>
        <LogoutButton />
      </div>
    </aside>
  );
}
