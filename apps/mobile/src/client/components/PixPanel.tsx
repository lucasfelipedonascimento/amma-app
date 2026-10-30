import { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { formatBRL } from '@amma/shared';
import { api } from '../../api';
import { errorMessage } from '../../errors';
import { colors } from '../../theme';
import { Button, ErrorText } from '../../ui';
import { Card } from '../../driver/components/layout';
import { useNow } from '../hooks';
import { formatClock, secondsLeft } from '../labels';
import type { PaymentInfo } from '../types';

/** Pix pendente: código "copia e cola", contagem do prazo e, no sandbox, o botão que simula o pagamento. */
export function PixPanel({
  deliveryId,
  payment,
  onPaid,
}: {
  deliveryId: string;
  payment: PaymentInfo;
  onPaid: () => void;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = secondsLeft(payment.pixExpiresAt, now);

  const simulate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/payments/sandbox/pix/${deliveryId}/confirm`, { method: 'POST', body: {} });
      onPaid();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={s.title}>Pague com Pix</Text>
      <Text style={s.muted}>
        Valor {formatBRL(payment.amountCents)}. O motorista só é chamado depois que o pagamento for
        confirmado.
      </Text>
      <Text selectable style={s.code} testID="pix-code">
        {payment.pixCode}
      </Text>
      <Button
        title="Compartilhar código Pix"
        kind="ghost"
        onPress={() => void Share.share({ message: payment.pixCode ?? '' })}
      />
      <View accessibilityLiveRegion="polite">
        <Text style={s.muted} testID="pix-timer">
          {left > 0 ? `Vence em ${formatClock(left)}` : 'Prazo encerrado'}
        </Text>
      </View>
      {payment.sandbox ? (
        <View style={s.sandbox}>
          <Text style={s.sandboxText}>Ambiente de testes: nenhum Pix real é cobrado.</Text>
          <Button
            title="Simular pagamento do Pix"
            onPress={simulate}
            loading={busy}
            disabled={left === 0}
          />
        </View>
      ) : null}
      <ErrorText message={error} />
    </Card>
  );
}

const s = StyleSheet.create({
  title: { color: colors.black, fontSize: 18, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 14 },
  code: {
    backgroundColor: colors.cream,
    borderRadius: 8,
    padding: 10,
    color: colors.black,
    fontSize: 12,
  },
  sandbox: { gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  sandboxText: { color: colors.warn, fontWeight: '600', fontSize: 13 },
});
