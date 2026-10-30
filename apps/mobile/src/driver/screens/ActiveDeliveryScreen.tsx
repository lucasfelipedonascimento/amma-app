import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { formatBRL } from '@amma/shared';
import { colors } from '../../theme';
import { Button, ErrorText } from '../../ui';
import { EmergencyButton } from '../components/EmergencyButton';
import { Card, Page } from '../components/layout';
import { RouteMap } from '../components/RouteMap';
import { OfflineBanner, WarnBanner } from '../components/states';
import { StepProgress } from '../components/StepProgress';
import { useDriver } from '../DriverProvider';
import { formatDistance, formatDuration } from '../format';
import { DELIVERY_STEPS, canRelease, completedSteps, nextStep } from '../steps';
import { useRouteInfo } from '../useRouteInfo';

/** Abre o app de mapas do celular com a rota até o destino (Google Maps, Waze, Apple Mapas...). */
const openNavigation = (lat: number, lng: number) =>
  Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  );

/** Entrega em andamento: mapa com a rota, 4 etapas, botão do próximo passo e emergência. */
export function ActiveDeliveryScreen() {
  const d = useDriver();
  const { route, error: routeError } = useRouteInfo(d.active, d.position);
  const a = d.active;
  if (!a) return null;

  const step = nextStep(a.status);
  const target = route?.target ?? (completedSteps(a.status) < 2 ? 'COLETA' : 'ENTREGA');
  const place = target === 'COLETA' ? a.pickup : a.dropoff;

  const confirmRelease = () =>
    Alert.alert(
      'Não consigo seguir',
      'O pedido volta para a fila e outro motorista recebe. Você não é punido.',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Liberar pedido', style: 'destructive', onPress: () => void d.release() },
      ],
    );

  return (
    <View style={{ flex: 1 }}>
      {d.offline ? <OfflineBanner /> : null}
      <Page>
        <RouteMap
          driver={d.position}
          pickup={a.pickup}
          dropoff={a.dropoff}
          target={target}
          path={route?.path ?? null}
        />
        {routeError && !route ? (
          <WarnBanner text="Rota indisponível agora. O mapa mostra os pontos; tente de novo em instantes." />
        ) : null}

        <Card>
          <Text style={s.label}>{target === 'COLETA' ? 'Ir buscar em' : 'Levar até'}</Text>
          <Text style={s.address} testID="target-address">
            {place.address}
          </Text>
          <Text style={s.meta}>
            {route
              ? `${formatDistance(route.distanceMeters)} · ${formatDuration(route.durationSeconds)}`
              : `${formatDistance(a.distanceMeters)} de corrida`}
            {' · '}
            {formatBRL(a.fareCents)}
          </Text>
          {a.notes ? <Text style={s.meta}>Obs.: {a.notes}</Text> : null}
          <Button
            title="Abrir no app de mapas"
            kind="ghost"
            onPress={() => void openNavigation(place.lat, place.lng)}
          />
        </Card>

        <Card>
          <StepProgress done={completedSteps(a.status)} />
        </Card>

        <ErrorText message={d.actionError} />
        {step ? (
          <Button
            title={step.action}
            onPress={() => void d.advance()}
            loading={d.busy}
            disabled={d.offline}
          />
        ) : null}
        {canRelease(a.status) ? (
          <Button
            title="Não consigo seguir"
            kind="ghost"
            onPress={confirmRelease}
            disabled={d.busy}
          />
        ) : null}
        <EmergencyButton />
        <Text style={s.hint}>
          {DELIVERY_STEPS.length} etapas: confirme cada uma ao concluir. O cliente acompanha você
          pelo mapa.
        </Text>
      </Page>
    </View>
  );
}

const s = StyleSheet.create({
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  address: { color: colors.black, fontSize: 18, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center' },
});
