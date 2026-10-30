import { StyleSheet, Text, View } from 'react-native';
import { formatBRL, type ReportDay } from '@amma/shared';
import { colors } from '../../theme';
import { weekdayLabel } from '../../driver/format';

const MAX_BAR = 100;

/** Gasto por dia (barras de View, como no gráfico de ganhos). Com muitos dias, some o rótulo. */
export function DayBars({ days, today }: { days: ReportDay[]; today: string }) {
  const max = Math.max(1, ...days.map((d) => d.spentCents));
  const labels = days.length <= 7;
  return (
    <View style={s.row} accessibilityLabel="Gasto por dia">
      {days.map((d) => (
        <View key={d.date} style={s.col} testID={`day-${d.date}`}>
          {labels ? (
            <Text style={s.value}>
              {d.spentCents > 0 ? formatBRL(d.spentCents).replace('R$', '').trim() : ''}
            </Text>
          ) : null}
          <View
            style={[
              s.bar,
              { height: Math.max(3, (d.spentCents / max) * MAX_BAR) },
              d.spentCents === 0 && { backgroundColor: colors.border },
              d.date === today && { backgroundColor: colors.black },
            ]}
          />
          {labels ? <Text style={s.day}>{weekdayLabel(d.date)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, minHeight: 140 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '80%', backgroundColor: colors.red, borderRadius: 4 },
  value: { color: colors.muted, fontSize: 10 },
  day: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' },
});
