import { StyleSheet, Text } from 'react-native';
import { COMPETITOR_FEE_PERCENT, formatBRL } from '@amma/shared';
import { colors } from '../../theme';
import type { Comparison } from '../types';
import { Card, Row } from './layout';

/** "Quanto você ficou" na AMMA x num app que cobra 25%, para o mesmo trabalho. */
export function ComparisonCard({
  title,
  deliveries,
  grossCents,
  netCents,
  comparison,
}: {
  title: string;
  deliveries: number;
  grossCents: number;
  netCents: number;
  comparison: Comparison;
}) {
  return (
    <Card>
      <Text style={s.title}>{title}</Text>
      <Text testID="net-total" style={s.net}>
        {formatBRL(netCents)}
      </Text>
      <Text style={s.meta}>
        {deliveries === 1 ? '1 entrega' : `${deliveries} entregas`} · {formatBRL(grossCents)} em
        corridas
      </Text>
      {deliveries > 0 ? (
        <>
          <Row label="Na AMMA você recebeu" value={formatBRL(netCents)} />
          <Row
            label={`Num app com ${COMPETITOR_FEE_PERCENT}% de taxa`}
            value={formatBRL(comparison.competitorNetCents)}
          />
          <Row
            label="A mais no seu bolso"
            value={`+ ${formatBRL(comparison.extraCents)}`}
            strong
            color={colors.ok}
            testID="extra-total"
          />
        </>
      ) : (
        <Text style={s.meta}>Quando você fizer entregas, mostramos aqui quanto ganhou a mais.</Text>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  title: { color: colors.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  net: { color: colors.black, fontSize: 34, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 14 },
});
