import { StyleSheet, Text, View } from 'react-native';
import { formatBRL } from '@amma/shared';
import { colors } from '../../theme';
import { formatDateTime } from '../format';
import type { HistoryItem } from '../types';
import { Card } from './layout';

export function HistoryList({ items }: { items: HistoryItem[] }) {
  if (items.length === 0)
    return (
      <Card>
        <Text style={s.empty}>Nenhuma entrega concluída ainda.</Text>
      </Card>
    );
  return (
    <Card>
      {items.map((h, i) => (
        <View key={h.id} style={[s.item, i > 0 && s.sep]} testID={`history-${h.id}`}>
          <View style={{ flex: 1 }}>
            <Text style={s.date}>{formatDateTime(h.deliveredAt)}</Text>
            <Text style={s.addr} numberOfLines={1}>
              {h.pickupAddress} → {h.dropoffAddress}
            </Text>
            <Text style={s.fees}>
              Corrida {formatBRL(h.fareCents)} · taxa {formatBRL(h.platformFeeCents)}
              {h.associationFeeCents > 0 ? ` · associação ${formatBRL(h.associationFeeCents)}` : ''}
            </Text>
          </View>
          <Text style={s.net}>{formatBRL(h.workerNetCents)}</Text>
        </View>
      ))}
    </Card>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  sep: { borderTopWidth: 1, borderTopColor: colors.border },
  date: { color: colors.muted, fontSize: 12 },
  addr: { color: colors.black, fontSize: 14, fontWeight: '600' },
  fees: { color: colors.muted, fontSize: 12 },
  net: { color: colors.ok, fontWeight: '800', fontSize: 16 },
  empty: { color: colors.muted, textAlign: 'center' },
});
