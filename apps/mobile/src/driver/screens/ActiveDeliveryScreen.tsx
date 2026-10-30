import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import {
  BOARDING_PIN_LENGTH,
  MAX_COMPLETION_DISTANCE_METERS,
  driverCancelOptions,
  formatBRL,
  haversineMeters,
  isValidBoardingPin,
} from '@amma/shared';
import { CancelReasonModal } from '../../CancelReasonModal';
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
import { completedSteps, nextStep, stepsFor } from '../steps';
import { useRouteInfo } from '../useRouteInfo';

/** Abre o app de mapas do celular com a rota até o destino (Google Maps, Waze, Apple Mapas...). */
const openNavigation = (lat: number, lng: number) =>
  Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  );

/**
 * Entrega ou corrida em andamento. Ao aceitar abre o mapa em tela cheia com o trajeto pelas ruas,
 * o próximo passo e o botão Cancelar; "Detalhes" mostra as 4 etapas, a emergência e a denúncia.
 * Na corrida, o embarque só é confirmado com o PIN que o passageiro mostra.
 */
export function ActiveDeliveryScreen() {
  const d = useDriver();
  const { route, error: routeError } = useRouteInfo(d.active, d.position);
  const [pin, setPin] = useState('');
  const [reporting, setReporting] = useState(false);
  const [view, setView] = useState<'mapa' | 'detalhes'>('mapa');
  const [cancelOpen, setCancelOpen] = useState(false);
  const a = d.active;
  const activeId = a?.id;

  // Pedido novo: volta para o mapa em tela cheia.
  useEffect(() => {
    setView('mapa');
    setCancelOpen(false);
    setPin('');
  }, [activeId]);

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

  const what = ride ? 'corrida' : 'entrega';
  const options = driverCancelOptions(a.status, a.kind).map((o) => ({
    key: o.key,
    label: o.label,
    hint:
      o.effect === 'RELEASE'
        ? `A ${what} volta para a fila e outro motorista recebe. Você não é punido.`
        : `A ${what} é cancelada e o cliente recebe o estorno.`,
  }));
  const effectOf = (key: string) =>
    driverCancelOptions(a.status, a.kind).find((o) => o.key === key)?.effect ?? 'CANCEL';
  const cancelModal = (
    <CancelReasonModal
      visible={cancelOpen}
      title="Por que você quer cancelar?"
      message="Escolha o motivo. Ele fica registrado."
      options={options}
      confirmLabel="Confirmar cancelamento"
      busy={d.busy}
      error={d.actionError}
      onClose={() => setCancelOpen(false)}
      onConfirm={(key) =>
        void d.cancelTrip(key, effectOf(key)).then((ok) => ok && setCancelOpen(false))
      }
    />
  );

  const controls = (
    <>
      {needsPin ? (
        <Field
          label="PIN do passageiro"
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, BOARDING_PIN_LENGTH))}
          keyboardType="number-pad"
          maxLength={BOARDING_PIN_LENGTH}
          placeholder="0000"
        />
      ) : null}
      <ErrorText message={cancelOpen ? null : d.actionError} />
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
    </>
  );

  const summary = (
    <>
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
    </>
  );

  if (view === 'mapa')
    return (
      <View style={{ flex: 1 }}>
        {d.offline ? <OfflineBanner /> : null}
        <View style={{ flex: 1 }}>
          <RouteMap
            fill
            inset={{ top: 190, bottom: needsPin ? 400 : 320 }}
            driver={d.position}
            pickup={a.pickup}
            dropoff={a.dropoff}
            target={target}
            path={route?.path ?? null}
          />
          <View style={s.top} pointerEvents="box-none">
            <View style={s.panel}>
              {summary}
              {routeError && !route ? (
                <Text style={s.meta}>Rota indisponível agora. Tente de novo em instantes.</Text>
              ) : null}
            </View>
          </View>
          <View style={s.bottom} pointerEvents="box-none">
            <View style={s.panel}>
              {controls}
              <EmergencyButton deliveryId={a.id} />
              <View style={s.actions}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Cancelar"
                    kind="ghost"
                    onPress={() => setCancelOpen(true)}
                    disabled={d.busy}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Detalhes" kind="ghost" onPress={() => setView('detalhes')} />
                </View>
              </View>
            </View>
          </View>
        </View>
        {cancelModal}
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      {d.offline ? <OfflineBanner /> : null}
      <Page>
        <Button title="‹ Ver mapa" kind="ghost" onPress={() => setView('mapa')} />
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
          {summary}
          {a.notes ? <Text style={s.meta}>Obs.: {a.notes}</Text> : null}
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
          </Card>
        ) : null}

        {controls}
        <Button
          title="Cancelar"
          kind="ghost"
          onPress={() => setCancelOpen(true)}
          disabled={d.busy}
        />
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
      {cancelModal}
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, padding: 12 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 },
  panel: {
    backgroundColor: colors.cream,
    borderRadius: 16,
    padding: 14,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  actions: { flexDirection: 'row', gap: 8 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  address: { color: colors.black, fontSize: 18, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center' },
});
