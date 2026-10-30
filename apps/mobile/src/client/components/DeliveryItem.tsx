import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatBRL } from '@amma/shared';
import { colors } from '../../theme';
import { formatDateTime } from '../../driver/format';
import { PAYMENT_STATUS_LABEL, isOpen, statusText } from '../labels';
import type { ClientDelivery } from '../types';

/** Uma linha do histórico de pedidos. */
export function DeliveryItem({ d, onPress }: { d: ClientDelivery; onPress: () => void }) {
  const tone =
    d.status === 'ENTREGUE' ? colors.ok : d.status === 'CANCELADO' ? colors.muted : colors.red;
  return (
    <Pressable
      onPress={onPress}
      style={s.item}
      testID={`delivery-${d.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Pedido de ${formatDateTime(d.createdAt)}, ${statusText(d)}`}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.date}>{formatDateTime(d.createdAt)}</Text>
        <Text style={s.addr} numberOfLines={1}>
          {d.pickup.address} → {d.dropoff.address}
        </Text>
        <Text style={[s.status, { color: tone }]}>
          {statusText(d)}
          {d.payment && !isOpen(d.status) ? ` · ${PAYMENT_STATUS_LABEL[d.payment.status]}` : ''}
        </Text>
      </View>
      <Text style={s.price}>{formatBRL(d.fareCents)}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  date: { color: colors.muted, fontSize: 12 },
  addr: { color: colors.black, fontSize: 14, fontWeight: '600' },
  status: { fontSize: 13, fontWeight: '700' },
  price: { color: colors.black, fontWeight: '800', fontSize: 16 },
});
