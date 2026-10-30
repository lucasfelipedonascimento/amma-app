import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { getSession } from '@/lib/session';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <div className="layout">
      <a className="skip" href="#conteudo">
        Ir para o conteúdo
      </a>
      <Nav name={session.name} roles={session.panelRoles} />
      <main id="conteudo">{children}</main>
    </div>
  );
}
