import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { formatBRL } from '@amma/shared';
import { useSession } from '../../session';
import { colors } from '../../theme';
import { Button, ErrorText } from '../../ui';
import { ComparisonCard } from '../components/ComparisonCard';
import { Card, Page } from '../components/layout';
import { OfferCard } from '../components/OfferCard';
import { OfflineBanner, WarnBanner } from '../components/states';
import { RateCard } from '../../safety/RateCard';
import { useDriver } from '../DriverProvider';

/** Início: online/offline, ganhos do dia (com o comparativo de 25%) e o pedido da vez. */
export function DriverHome() {
  const { me } = useSession();
  const d = useDriver();

  return (
    <View style={{ flex: 1 }}>
      {d.offline ? <OfflineBanner /> : null}
      {!d.offline && d.online && d.realtime !== 'open' ? (
        <WarnBanner text="Reconectando ao tempo real… atualizando a cada poucos segundos." />
      ) : null}
      <Page onRefresh={() => void d.reload()}>
        <Text style={s.hello}>Olá, {me?.name?.split(' ')[0] ?? 'motorista'}</Text>

        <Card>
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: d.online ? colors.ok : colors.muted }]} />
            <Text style={s.status} testID="presence-label">
              {d.online ? 'Você está online' : 'Você está offline'}
            </Text>
          </View>
          {d.online ? (
            <Button
              title="Ficar offline"
              kind="ghost"
              onPress={() => void d.goOffline()}
              loading={d.busy}
              disabled={!!d.active}
            />
          ) : (
            <Button title="Ficar online" onPress={() => void d.goOnline()} loading={d.busy} />
          )}
          {d.online && d.active ? (
            <Text style={s.hint}>Termine a entrega em andamento para ficar offline.</Text>
          ) : null}
          <ErrorText message={d.actionError} />
        </Card>

        {d.online && d.access === 'foreground' ? (
          <Card style={s.notice}>
            <Text style={s.noticeTitle}>Só com o app aberto</Text>
            <Text style={s.hint}>
              Para receber pedidos com a tela apagada, permita a localização “o tempo todo” nas
              Configurações do celular.
            </Text>
            <Button title="Abrir configurações" kind="ghost" onPress={d.openSettings} />
          </Card>
        ) : null}
        {!d.online && d.access === 'denied' ? (
          <Card style={s.notice}>
            <Text style={s.noticeTitle}>Localização bloqueada</Text>
            <Text style={s.hint}>Sem a localização não dá para receber pedidos perto de você.</Text>
            <Button title="Abrir configurações" kind="ghost" onPress={d.openSettings} />
          </Card>
        ) : null}
        {d.online && d.pushNote ? <Text style={s.hint}>{d.pushNote}</Text> : null}

        {d.completed ? (
          <Card style={s.done}>
            <Text style={s.doneTitle}>
              {d.completed.rideId ? 'Corrida concluída ✓' : 'Entrega concluída ✓'}
            </Text>
            <Text style={s.doneText}>
              Você recebeu {formatBRL(d.completed.workerNetCents)} de uma corrida de{' '}
              {formatBRL(d.completed.fareCents)}.
            </Text>
            {d.completed.rideId ? null : (
              <Button title="Ok" kind="ghost" onPress={d.dismissCompleted} />
            )}
          </Card>
        ) : null}
        {d.completed?.rideId ? (
          <RateCard
            title="Como foi o passageiro?"
            path={`/driver/deliveries/${d.completed.rideId}/rating`}
            onRated={d.dismissCompleted}
            onSkip={d.dismissCompleted}
          />
        ) : null}

        {d.earnings ? (
          <ComparisonCard
            title="Ganhos de hoje"
            deliveries={d.earnings.today.deliveries}
            grossCents={d.earnings.today.grossCents}
            netCents={d.earnings.today.netCents}
            comparison={d.earnings.today}
          />
        ) : d.earningsError ? (
          <Card>
            <Text style={s.hint}>Não foi possível carregar seus ganhos: {d.earningsError}</Text>
            <Button title="Tentar de novo" kind="ghost" onPress={() => void d.refreshEarnings()} />
          </Card>
        ) : (
          <Card>
            <ActivityIndicator color={colors.red} />
          </Card>
        )}

        {d.offer ? (
          <OfferCard
            offer={d.offer}
            busy={d.busy}
            onAccept={() => void d.accept()}
            onDecline={() => void d.decline()}
          />
        ) : d.online ? (
          <Card>
            <ActivityIndicator color={colors.red} />
            <Text style={s.waiting}>Procurando pedidos perto de você…</Text>
          </Card>
        ) : (
          <Text style={s.hint}>Fique online para começar a receber pedidos.</Text>
        )}
      </Page>
    </View>
  );
}

const s = StyleSheet.create({
  hello: { color: colors.black, fontSize: 26, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  status: { color: colors.black, fontSize: 18, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 14 },
  waiting: { color: colors.muted, textAlign: 'center' },
  notice: { borderColor: colors.warn },
  noticeTitle: { color: colors.warn, fontWeight: '800' },
  done: { borderColor: colors.ok },
  doneTitle: { color: colors.ok, fontWeight: '800', fontSize: 18 },
  doneText: { color: colors.black },
});
