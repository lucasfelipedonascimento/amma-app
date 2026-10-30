import { useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { TabBar } from '../driver/components/TabBar';
import { ClientProvider, useClient } from './ClientProvider';
import { isOpen } from './labels';
import { ClientAccountScreen } from './screens/ClientAccountScreen';
import { MerchantScreen } from './screens/MerchantScreen';
import { NewDeliveryScreen } from './screens/NewDeliveryScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { RideScreen } from './screens/RideScreen';
import { ReceiptScreen } from './screens/ReceiptScreen';
import { ReportScreen } from './screens/ReportScreen';
import { TrackingScreen } from './screens/TrackingScreen';

type TabKey = 'pedir' | 'corrida' | 'pedidos' | 'loja' | 'relatorio' | 'conta';
type Overlay = { kind: 'tracking'; id: string } | { kind: 'receipt'; id: string } | null;

/** App de quem pede entregas e corridas (passageiro/cliente e comerciante). */
export function ClientApp() {
  return (
    <ClientProvider>
      <ClientTabs />
    </ClientProvider>
  );
}

export function ClientTabs() {
  const { isMerchant, isPassenger, deliveries } = useClient();
  const [tab, setTab] = useState<TabKey>('pedir');
  const [overlay, setOverlay] = useState<Overlay>(null);

  // Botão voltar do Android fecha o acompanhamento/recibo em vez de sair do app.
  useEffect(() => {
    if (!overlay) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOverlay(overlay.kind === 'receipt' ? { kind: 'tracking', id: overlay.id } : null);
      return true;
    });
    return () => sub.remove();
  }, [overlay]);

  const tabs = [
    { key: 'pedir' as const, label: 'Entrega' },
    ...(isPassenger ? [{ key: 'corrida' as const, label: 'Corrida' }] : []),
    {
      key: 'pedidos' as const,
      label: 'Pedidos',
      badge: !!deliveries?.some((d) => isOpen(d.status)),
    },
    ...(isMerchant
      ? [
          { key: 'loja' as const, label: 'Loja' },
          { key: 'relatorio' as const, label: 'Relatório' },
        ]
      : []),
    { key: 'conta' as const, label: 'Conta' },
  ];

  const open = (id: string) => setOverlay({ kind: 'tracking', id });

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {overlay?.kind === 'tracking' ? (
          <TrackingScreen
            id={overlay.id}
            onBack={() => setOverlay(null)}
            onReceipt={() => setOverlay({ kind: 'receipt', id: overlay.id })}
          />
        ) : overlay?.kind === 'receipt' ? (
          <ReceiptScreen id={overlay.id} onBack={() => open(overlay.id)} />
        ) : (
          <>
            {tab === 'pedir' && (
              <NewDeliveryScreen
                onCreated={(id) => {
                  setTab('pedidos');
                  open(id);
                }}
                onOpenStore={() => setTab('loja')}
              />
            )}
            {tab === 'corrida' && <RideScreen onOpen={open} />}
            {tab === 'pedidos' && <OrdersScreen onOpen={open} />}
            {tab === 'loja' && <MerchantScreen />}
            {tab === 'relatorio' && <ReportScreen />}
            {tab === 'conta' && <ClientAccountScreen />}
          </>
        )}
      </View>
      <TabBar
        tabs={tabs}
        current={tab}
        onChange={(k) => {
          setOverlay(null);
          setTab(k);
        }}
      />
    </View>
  );
}
