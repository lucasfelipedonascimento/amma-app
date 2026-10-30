import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AssociationScreen } from '../association/AssociationScreen';
import { TabBar } from './components/TabBar';
import { ErrorView, LoadingView } from './components/states';
import { DriverProvider, useDriver } from './DriverProvider';
import { AccountScreen } from './screens/AccountScreen';
import { ActiveDeliveryScreen } from './screens/ActiveDeliveryScreen';
import { DriverHome } from './screens/DriverHome';
import { EarningsScreen } from './screens/EarningsScreen';
import { LocationConsentScreen } from './screens/LocationConsentScreen';

type TabKey = 'inicio' | 'entrega' | 'ganhos' | 'amma' | 'conta';

/** App do motorista aprovado: Início, Entrega (só com pedido em andamento), Ganhos, AMMA (associação) e Conta. */
export function DriverApp() {
  return (
    <DriverProvider>
      <DriverTabs />
    </DriverProvider>
  );
}

export function DriverTabs() {
  const d = useDriver();
  const [tab, setTab] = useState<TabKey>('inicio');
  const activeId = d.active?.id;

  // Aceitou um pedido: vai direto para a entrega. Terminou: volta ao início.
  useEffect(() => {
    if (activeId) setTab('entrega');
    else setTab((t) => (t === 'entrega' ? 'inicio' : t));
  }, [activeId]);

  if (d.loadError && !d.ready)
    return <ErrorView message={d.loadError} onRetry={() => void d.reload()} />;
  if (!d.ready) return <LoadingView />;

  if (d.consentOpen)
    return (
      <LocationConsentScreen
        busy={d.busy}
        error={d.actionError}
        onAccept={() => void d.acceptConsent()}
        onDecline={d.closeConsent}
      />
    );

  const tabs = [
    { key: 'inicio' as const, label: 'Início' },
    ...(d.active ? [{ key: 'entrega' as const, label: 'Entrega', badge: true }] : []),
    { key: 'ganhos' as const, label: 'Ganhos' },
    { key: 'amma' as const, label: 'AMMA' },
    { key: 'conta' as const, label: 'Conta' },
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {tab === 'inicio' && <DriverHome />}
        {tab === 'entrega' && <ActiveDeliveryScreen />}
        {tab === 'ganhos' && <EarningsScreen />}
        {tab === 'amma' && <AssociationScreen />}
        {tab === 'conta' && <AccountScreen />}
      </View>
      <TabBar tabs={tabs} current={tab} onChange={setTab} />
    </View>
  );
}
