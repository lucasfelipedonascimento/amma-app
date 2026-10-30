import { Share, StyleSheet, Text } from 'react-native';
import { formatBRL, type Receipt } from '@amma/shared';
import { api } from '../../api';
import { colors } from '../../theme';
import { Button } from '../../ui';
import { Card, Heading, Page, Row } from '../../driver/components/layout';
import { ErrorView, LoadingView } from '../../driver/components/states';
import { formatDateTime, formatDistance } from '../../driver/format';
import { useRemote } from '../hooks';
import { PAYMENT_STATUS_LABEL } from '../labels';
import { paymentLine, receiptText } from '../receiptText';

/** Recibo do pagamento, com opção de compartilhar. Não é nota fiscal (o aviso fica na tela). */
export function ReceiptScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: r, error, reload } = useRemote(() => api<Receipt>(`/deliveries/${id}/receipt`), id);
  if (!r)
    return error ? (
      <ErrorView message={error} onRetry={() => void reload()} />
    ) : (
      <LoadingView label="Carregando o recibo…" />
    );
  const p = r.payment!;
  return (
    <Page>
      <Button title="‹ Voltar" kind="ghost" onPress={onBack} />
      <Heading>Recibo</Heading>
      <Text style={s.number} testID="receipt-number">
        {r.number}
      </Text>
      <Card>
        <Row label="Data" value={formatDateTime(r.createdAt)} />
        <Row label="Coleta" value={r.pickupAddress} />
        <Row label="Entrega" value={r.dropoffAddress} />
        <Row label="Distância" value={formatDistance(r.distanceMeters)} />
        <Row label="Valor da entrega" value={formatBRL(r.fareCents)} />
        <Row label="Pagamento" value={paymentLine(p)} />
        <Row label="Situação" value={PAYMENT_STATUS_LABEL[p.status]} />
        {r.refundedCents > 0 ? (
          <Row label="Estornado" value={formatBRL(r.refundedCents)} color={colors.ok} strong />
        ) : (
          <Row label="Total pago" value={formatBRL(r.paidCents)} strong />
        )}
      </Card>
      <Text style={s.notice}>{r.notice}</Text>
      <Button
        title="Compartilhar recibo"
        onPress={() => void Share.share({ message: receiptText(r) })}
      />
    </Page>
  );
}

const s = StyleSheet.create({
  number: { color: colors.red, fontWeight: '800', letterSpacing: 1 },
  notice: { color: colors.muted, fontSize: 12 },
});
