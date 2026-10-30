import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import {
  BOARDING_PIN_LENGTH,
  MAX_COMPLETION_DISTANCE_METERS,
  formatBRL,
  haversineMeters,
  isValidBoardingPin,
} from '@amma/shared';
import { colors } from '../../theme';
import { Button, ErrorText, Field } from '../../ui';
import { ReportCard } from '../../safety/ReportCard';
import { EmergencyButton } from '../components/EmergencyButton';
import { Card, Page } from '../components/layout';
import { RouteMap } from '../components/RouteMap';
import { OfflineBanner, WarnBanner } from '../components/states';
import { StepProgress } from '../components/StepProgress';
import { useDriver } from '../DriverProvider';
import { formatDistance, formatDuration, formatRating } from '../format';
import { canRelease, completedSteps, nextStep, stepsFor } from '../steps';
import { useRouteInfo } from '../useRouteInfo';

/** Abre o app de mapas do celular com a rota até o destino (Google Maps, Waze, Apple Mapas...). */
const openNavigation = (lat: number, lng: number) =>
  Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  );

/**
 * Entrega ou corrida em andamento: mapa com a rota, 4 etapas, botão do próximo passo e emergência.
 * Na corrida, o embarque só é confirmado com o PIN que o passageiro mostra.
 */
export function ActiveDeliveryScreen() {
  const d = useDriver();
  const { route, error: routeError } = useRouteInfo(d.active, d.position);
  const [pin, setPin] = useState('');
  const [reporting, setReporting] = useState(false);
  const a = d.active;
  if (!a) return null;

  const ride = a.kind === 'CORRIDA';
  const step = nextStep(a.status, a.kind);
  const target = route?.target ?? (completedSteps(a.status) < 2 ? 'COLETA' : 'ENTREGA');
  const place = target === 'COLETA' ? a.pickup : a.dropoff;
  const needsPin = ride && step?.reaches === 'COLETADO';
  const pinOk = !needsPin || isValidBoardingPin(pin);
  // Só conforto: quem decide é o servidor (a posição que ele recebeu). Sem posição, deixa tentar.
  const metersToDropoff =
    step?.reaches === 'ENTREGUE' && d.position ? haversineMeters(d.position, a.dropoff) : null;
  const tooFar = metersToDropoff !== null && metersToDropoff > MAX_COMPLETION_DISTANCE_METERS;

  const confirmRelease = () =>
    Alert.alert(
      'Não consigo seguir',
      ride
        ? 'A corrida volta para a fila e outro motorista recebe. Você não é punido.'
        : 'O pedido volta para a fila e outro motorista recebe. Você não é punido.',
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
          <Text style={s.label}>
            {target === 'COLETA'
              ? ride
                ? 'Ir buscar o passageiro em'
                : 'Ir buscar em'
              : ride
                ? 'Levar o passageiro até'
                : 'Levar até'}
          </Text>
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
          {ride && a.passenger ? (
            <Text style={s.meta} testID="passenger-line">
              Passageiro{a.passenger.firstName ? `: ${a.passenger.firstName}` : ''} ·{' '}
              {formatRating(a.passenger.rating)}
            </Text>
          ) : null}
          <Button
            title="Abrir no app de mapas"
            kind="ghost"
            onPress={() => void openNavigation(place.lat, place.lng)}
          />
        </Card>

        <Card>
          <StepProgress done={completedSteps(a.status)} kind={a.kind} />
        </Card>

        {needsPin ? (
          <Card>
            <Text style={s.label}>PIN de embarque</Text>
            <Text style={s.meta}>
              Peça ao passageiro o PIN que aparece no app dele. É assim que você confirma quem está
              embarcando.
            </Text>
            <Field
              label="PIN do passageiro"
              value={pin}
              onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, BOARDING_PIN_LENGTH))}
              keyboardType="number-pad"
              maxLength={BOARDING_PIN_LENGTH}
              placeholder="0000"
            />
          </Card>
        ) : null}

        <ErrorText message={d.actionError} />
        {tooFar ? (
          <WarnBanner
            text={`Você está a ${formatDistance(metersToDropoff)} do destino. Chegue a até ${MAX_COMPLETION_DISTANCE_METERS} m para concluir.`}
          />
        ) : null}
        {step ? (
          <Button
            title={step.action}
            onPress={() => void (needsPin ? d.advance(pin) : d.advance())}
            loading={d.busy}
            disabled={d.offline || !pinOk || tooFar}
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
        <EmergencyButton deliveryId={a.id} />
        {ride ? (
          reporting ? (
            <ReportCard deliveryId={a.id} onClose={() => setReporting(false)} />
          ) : (
            <Button title="Denunciar" kind="ghost" onPress={() => setReporting(true)} />
          )
        ) : null}
        <Text style={s.hint}>
          {stepsFor(a.kind).length} etapas: confirme cada uma ao concluir.{' '}
          {ride ? 'O passageiro' : 'O cliente'} acompanha você pelo mapa.
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
