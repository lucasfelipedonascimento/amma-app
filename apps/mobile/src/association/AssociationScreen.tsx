import { useState } from 'react';
import { Heading, Page } from '../driver/components/layout';
import { AssemblyTab } from './AssemblyTab';
import { InsuranceTab } from './InsuranceTab';
import { Segments } from './parts';
import { PurchaseTab } from './PurchaseTab';
import { SummaryTab } from './SummaryTab';

type Section = 'resumo' | 'assembleia' | 'compra' | 'seguro';

/** Área da associação no app do motorista: resumo, assembleia, compra coletiva e seguro mútuo. */
export function AssociationScreen() {
  const [section, setSection] = useState<Section>('resumo');
  return (
    <Page>
      <Heading>Associação</Heading>
      <Segments
        items={[
          { key: 'resumo', label: 'Resumo' },
          { key: 'assembleia', label: 'Assembleia' },
          { key: 'compra', label: 'Compra' },
          { key: 'seguro', label: 'Seguro' },
        ]}
        current={section}
        onChange={setSection}
      />
      {section === 'resumo' && <SummaryTab />}
      {section === 'assembleia' && <AssemblyTab />}
      {section === 'compra' && <PurchaseTab />}
      {section === 'seguro' && <InsuranceTab />}
    </Page>
  );
}
