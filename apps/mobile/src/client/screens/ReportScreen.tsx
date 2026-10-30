import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MERCHANT_REPORT_PERIODS, formatBRL, type MerchantReport } from '@amma/shared';
import { api } from '../../api';
import { colors } from '../../theme';
import { Card, Heading, Page, Row } from '../../driver/components/layout';
import { ErrorView, LoadingView } from '../../driver/components/states';
import { DayBars } from '../components/DayBars';
import { useRemote } from '../hooks';

/** Relatório simples do comerciante: quanto gastou, quantas entregas, cancelamentos e gasto por dia. */
export function ReportScreen() {
  const [days, setDays] = useState<number>(7);
  const {
    data: r,
    error,
    reload,
  } = useRemote(() => api<MerchantReport>(`/merchant/report?days=${days}`), String(days));

  return (
    <Page onRefresh={() => void reload()}>
      <Heading>Relatório</Heading>
      <View style={s.periods} accessibilityRole="tablist">
        {MERCHANT_REPORT_PERIODS.map((p) => (
          <Pressable
            key={p}
            onPress={() => setDays(p)}
            accessibilityRole="tab"
            accessibilityState={{ selected: p === days }}
            style={[s.period, p === days && s.periodOn]}
          >
            <Text style={[s.periodText, p === days && { color: colors.white }]}>{p} dias</Text>
          </Pressable>
        ))}
      </View>
      {!r ? (
        error ? (
          <ErrorView message={error} onRetry={() => void reload()} />
        ) : (
          <LoadingView label="Montando o relatório…" />
        )
      ) : (
        <>
          <Card>
            <Text style={s.big} testID="report-spent">
              {formatBRL(r.spentCents)}
            </Text>
            <Text style={s.muted}>gastos com entregas nos últimos {r.days} dias</Text>
          </Card>
          <Card>
            <Row label="Pedidos" value={String(r.total)} />
            <Row label="Entregues" value={String(r.delivered)} />
            <Row label="Em andamento" value={String(r.inProgress)} />
            <Row
              label="Cancelados"
              value={`${r.cancelled} (${String(r.cancelRatePercent).replace('.', ',')}%)`}
            />
            <Row label="Gasto médio por entrega" value={formatBRL(r.averageTicketCents)} />
            <Row label="Estornado" value={formatBRL(r.refundedCents)} />
          </Card>
          <Card>
            <Text style={s.title}>Gasto por dia</Text>
            <DayBars days={r.perDay} today={r.to} />
          </Card>
          <Text style={s.muted}>
            Considera só o que foi pago. Pix não pago e pedidos estornados não entram no gasto.
          </Text>
        </>
      )}
    </Page>
  );
}

const s = StyleSheet.create({
  periods: { flexDirection: 'row', gap: 8 },
  period: {
    flex: 1,
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  periodOn: { backgroundColor: colors.red, borderColor: colors.red },
  periodText: { color: colors.black, fontWeight: '700' },
  big: { color: colors.black, fontSize: 32, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 13 },
  title: { color: colors.black, fontSize: 16, fontWeight: '800' },
});
