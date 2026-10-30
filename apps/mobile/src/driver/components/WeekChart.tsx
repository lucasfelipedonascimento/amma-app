import { StyleSheet, Text, View } from 'react-native';
import { formatBRL, type DaySummary } from '@amma/shared';
import { colors } from '../../theme';
import { weekdayLabel } from '../format';

const MAX_BAR = 110;

/** Barras do líquido de cada dia da semana (sem biblioteca de gráfico: são só Views). */
export function WeekChart({ days, today }: { days: DaySummary[]; today: string }) {
  const max = Math.max(1, ...days.map((d) => d.netCents));
  return (
    <View style={s.row}>
      {days.map((d) => (
        <View key={d.date} style={s.col} testID={`day-${d.date}`}>
          <Text style={s.value}>
            {d.netCents > 0 ? formatBRL(d.netCents).replace('R$', '').trim() : ''}
          </Text>
          <View
            style={[
              s.bar,
              { height: Math.max(4, (d.netCents / max) * MAX_BAR) },
              d.netCents === 0 && { backgroundColor: colors.border },
              d.date === today && { backgroundColor: colors.black },
            ]}
          />
          <Text style={[s.day, d.date === today && { color: colors.black, fontWeight: '800' }]}>
            {weekdayLabel(d.date)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
    minHeight: 150,
  },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '70%', backgroundColor: colors.red, borderRadius: 6 },
  value: { color: colors.muted, fontSize: 10 },
  day: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' },
});
