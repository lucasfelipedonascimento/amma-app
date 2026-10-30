import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatBRL, offerBreakdown } from '@amma/shared';
import { colors } from '../../theme';
import { Button } from '../../ui';
import { formatDistance, formatDuration, secondsUntil } from '../format';
import type { Offer } from '../types';
import { Card, Row } from './layout';

/** Pedido novo: o que é a corrida e, principalmente, quanto sobra para o motorista. */
export function OfferCard({
  offer,
  busy,
  onAccept,
  onDecline,
}: {
  offer: Offer;
  busy?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [left, setLeft] = useState(() => secondsUntil(offer.expiresAt));
  useEffect(() => {
    setLeft(secondsUntil(offer.expiresAt));
    const t = setInterval(() => setLeft(secondsUntil(offer.expiresAt)), 1000);
    return () => clearInterval(t);
  }, [offer.expiresAt]);

  const b = offerBreakdown(offer.fareCents, offer.estimatedNetCents);
  const assoc =
    b.associationRate === null
      ? 'Taxa da associação'
      : `Taxa da associação (${b.associationRate}%)`;

  return (
    <Card style={s.card}>
      <View style={s.header}>
        <Text style={s.title}>Novo pedido</Text>
        <Text testID="offer-timer" style={[s.timer, left <= 10 && { color: colors.red }]}>
          {left} s
        </Text>
      </View>

      <Text style={s.label}>Coleta</Text>
      <Text style={s.address}>{offer.pickup.address}</Text>
      <Text style={s.label}>Entrega</Text>
      <Text style={s.address}>{offer.dropoff.address}</Text>
      <Text style={s.meta}>
        {formatDistance(offer.distanceToPickupMeters)} até a coleta
        {offer.pickupEtaSeconds ? ` (${formatDuration(offer.pickupEtaSeconds)})` : ''} ·{' '}
        {formatDistance(offer.deliveryDistanceMeters)} de corrida
      </Text>
      {offer.notes ? <Text style={s.meta}>Obs.: {offer.notes}</Text> : null}

      <View style={s.values}>
        <Row label="Valor da corrida" value={formatBRL(b.grossCents)} />
        <Row label="Taxa base (10%)" value={`− ${formatBRL(b.platformFeeCents)}`} />
        <Row label={assoc} value={`− ${formatBRL(b.associationFeeCents)}`} />
        <Row
          label="Você recebe"
          value={formatBRL(b.netCents)}
          strong
          color={colors.ok}
          testID="offer-net"
        />
      </View>

      <Button title="Aceitar" onPress={onAccept} loading={busy} />
      <Button title="Recusar" kind="ghost" onPress={onDecline} disabled={busy} />
      <Text style={s.hint}>Recusar não tem punição.</Text>
    </Card>
  );
}

const s = StyleSheet.create({
  card: { borderColor: colors.red, borderWidth: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.red, fontWeight: '800', fontSize: 20 },
  timer: { color: colors.black, fontWeight: '800', fontSize: 20, fontVariant: ['tabular-nums'] },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  address: { color: colors.black, fontSize: 16, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 14 },
  values: {
    backgroundColor: colors.cream,
    borderRadius: 10,
    padding: 12,
    gap: 6,
    marginVertical: 4,
  },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center' },
});
