import { Pressable, StyleSheet, Text } from 'react-native';
import { cardBrand, parseCardExpiry, type PaymentMethod } from '@amma/shared';
import { api } from '../../api';
import { colors } from '../../theme';
import { Card } from '../../driver/components/layout';
import { METHOD_LABEL } from '../labels';
import type { PaymentConfig } from '../types';
import { CardForm, cardProblem, type CardFields } from './CardForm';

/** Escolha entre Pix e cartão (e o formulário do cartão), igual para entregas e corridas. */
export function PaymentSection({
  method,
  onMethod,
  card,
  onCard,
  sandbox,
}: {
  method: PaymentMethod;
  onMethod: (m: PaymentMethod) => void;
  card: CardFields;
  onCard: (c: CardFields) => void;
  sandbox: boolean;
}) {
  return (
    <>
      <Text style={s.section}>Como você quer pagar?</Text>
      {(['PIX', 'CARTAO'] as const).map((m) => (
        <Pressable
          key={m}
          onPress={() => onMethod(m)}
          accessibilityRole="radio"
          accessibilityState={{ selected: method === m }}
          style={[s.option, method === m && s.optionOn]}
        >
          <Text style={s.optionTitle}>{METHOD_LABEL[m]}</Text>
          <Text style={s.muted}>
            {m === 'PIX'
              ? 'Pague no app do seu banco; o motorista é chamado ao confirmar.'
              : 'Cobrado na hora.'}
          </Text>
        </Pressable>
      ))}
      {method === 'CARTAO' ? (
        <Card>
          <CardForm value={card} onChange={onCard} sandbox={sandbox} />
          {card.number ? <Text style={s.muted}>Bandeira: {cardBrand(card.number)}</Text> : null}
        </Card>
      ) : null}
    </>
  );
}

/**
 * Monta o que a API recebe como pagamento. No cartão, troca os dados por um token do provedor
 * (a AMMA nunca recebe o número). Lança Error com a mensagem para a tela quando algo está errado.
 */
export async function buildPayment(
  method: PaymentMethod,
  card: CardFields,
  config: PaymentConfig | null,
): Promise<{ method: PaymentMethod; cardToken?: string }> {
  if (method !== 'CARTAO') return { method };
  const problem = cardProblem(card);
  if (problem) throw new Error(problem);
  if (!config?.sandbox) throw new Error('Pagamento com cartão indisponível no momento. Use o Pix.');
  // Sandbox: a API faz o papel do SDK do provedor. Com provedor real, o token vem do SDK no app.
  const exp = parseCardExpiry(card.expiry)!;
  const t = await api<{ token: string }>('/payments/sandbox/card-tokens', {
    body: { number: card.number, expMonth: exp.month, expYear: exp.year, cvv: card.cvv },
  });
  return { method, cardToken: t.token };
}

const s = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 },
  section: { color: colors.black, fontWeight: '800', fontSize: 16, marginTop: 6 },
  option: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 2,
  },
  optionOn: { borderColor: colors.red },
  optionTitle: { color: colors.black, fontWeight: '700', fontSize: 17 },
});
