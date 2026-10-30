import { Text } from 'react-native';
import { Card, Heading, Page } from '../../driver/components/layout';
import { ErrorView, LoadingView, OfflineBanner } from '../../driver/components/states';
import { colors } from '../../theme';
import { useClient } from '../ClientProvider';
import { DeliveryItem } from '../components/DeliveryItem';
import { isOpen } from '../labels';

/** Histórico: em andamento primeiro, depois os concluídos e cancelados. */
export function OrdersScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const { deliveries, deliveriesError, reloadDeliveries, offline } = useClient();
  if (!deliveries)
    return deliveriesError ? (
      <ErrorView message={deliveriesError} onRetry={() => void reloadDeliveries()} />
    ) : (
      <LoadingView label="Carregando seus pedidos…" />
    );
  const open = deliveries.filter((d) => isOpen(d.status));
  const past = deliveries.filter((d) => !isOpen(d.status));
  return (
    <Page onRefresh={() => void reloadDeliveries()}>
      {offline ? <OfflineBanner /> : null}
      <Heading>Seus pedidos</Heading>
      {deliveriesError ? (
        <Text style={{ color: colors.warn }}>
          Não foi possível atualizar. Mostrando o que já tínhamos.
        </Text>
      ) : null}
      {deliveries.length === 0 ? (
        <Card>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>
            Você ainda não fez nenhum pedido.
          </Text>
        </Card>
      ) : null}
      {open.length > 0 ? (
        <Text style={{ color: colors.black, fontWeight: '800' }}>Em andamento</Text>
      ) : null}
      {open.map((d) => (
        <DeliveryItem key={d.id} d={d} onPress={() => onOpen(d.id)} />
      ))}
      {past.length > 0 ? (
        <Text style={{ color: colors.black, fontWeight: '800' }}>Anteriores</Text>
      ) : null}
      {past.map((d) => (
        <DeliveryItem key={d.id} d={d} onPress={() => onOpen(d.id)} />
      ))}
    </Page>
  );
}
