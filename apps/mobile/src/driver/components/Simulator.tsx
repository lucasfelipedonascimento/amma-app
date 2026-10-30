import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ASSOCIATION_RATES,
  COMPETITOR_FEE_PERCENT,
  formatBRL,
  simulateEarnings,
  type AssociationRate,
} from '@amma/shared';
import { colors } from '../../theme';
import { Field } from '../../ui';
import { parseReaisToCents } from '../format';
import { Card, Row } from './layout';

/** "E se eu fizer uma corrida de R$ X?" — mostra o desconto de cada taxa e o que sobra. */
export function Simulator({ initialRate = 0 }: { initialRate?: AssociationRate }) {
  const [text, setText] = useState('20,00');
  const [rate, setRate] = useState<AssociationRate>(initialRate);
  const cents = parseReaisToCents(text);
  const r = cents !== null && cents > 0 ? simulateEarnings(cents, rate) : null;

  return (
    <Card>
      <Text style={s.title}>Simulador</Text>
      <Field
        label="Valor da corrida (R$)"
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        accessibilityLabel="Valor da corrida"
      />
      <Text style={s.label}>Taxa da associação</Text>
      <View style={s.chips}>
        {ASSOCIATION_RATES.map((v) => (
          <Pressable
            key={v}
            onPress={() => setRate(v)}
            accessibilityRole="button"
            accessibilityState={{ selected: rate === v }}
            style={[s.chip, rate === v && s.chipOn]}
          >
            <Text style={[s.chipText, rate === v && { color: colors.white }]}>{v}%</Text>
          </Pressable>
        ))}
      </View>
      {r ? (
        <View style={s.result}>
          <Row label="Valor da corrida" value={formatBRL(r.grossCents)} />
          <Row label="Taxa base (10%)" value={`− ${formatBRL(r.platformFeeCents)}`} />
          <Row label={`Associação (${rate}%)`} value={`− ${formatBRL(r.associationFeeCents)}`} />
          <Row
            label="Você recebe"
            value={formatBRL(r.workerNetCents)}
            strong
            color={colors.ok}
            testID="sim-net"
          />
          <Row
            label={`Num app com ${COMPETITOR_FEE_PERCENT}%`}
            value={formatBRL(r.competitorNetCents)}
          />
          <Row
            label="Diferença"
            value={`+ ${formatBRL(r.extraCents)}`}
            color={colors.ok}
            testID="sim-extra"
          />
          {rate > 0 ? (
            <Text style={s.hint}>
              A taxa da associação vira cotas suas (1 cota = R$ 5,00), não é perdida.
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={s.hint}>Digite um valor para ver quanto sobra.</Text>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  title: { color: colors.black, fontSize: 18, fontWeight: '800' },
  label: { color: colors.black, fontWeight: '600' },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipText: { color: colors.black, fontWeight: '700' },
  result: { backgroundColor: colors.cream, borderRadius: 10, padding: 12, gap: 6 },
  hint: { color: colors.muted, fontSize: 13 },
});
