import { StyleSheet, Text, View } from 'react-native';
import {
  cardBrand,
  isValidCardCvv,
  isValidCardNumber,
  maskCardExpiry,
  maskCardNumber,
  parseCardExpiry,
} from '@amma/shared';
import { colors } from '../../theme';
import { Field } from '../../ui';

export interface CardFields {
  number: string;
  expiry: string;
  cvv: string;
}

export const EMPTY_CARD: CardFields = { number: '', expiry: '', cvv: '' };

/** Primeiro problema encontrado nos dados do cartão, ou null se estão ok. */
export function cardProblem(c: CardFields, now = new Date()): string | null {
  if (!isValidCardNumber(c.number)) return 'Confira o número do cartão.';
  if (!parseCardExpiry(c.expiry, now)) return 'Validade inválida ou cartão vencido.';
  if (!isValidCardCvv(c.cvv, cardBrand(c.number))) return 'Confira o código de segurança.';
  return null;
}

/** Os dados do cartão só passam por aqui para virar um token; nada é guardado no aparelho nem na AMMA. */
export function CardForm({
  value,
  onChange,
  sandbox,
}: {
  value: CardFields;
  onChange: (c: CardFields) => void;
  sandbox: boolean;
}) {
  return (
    <View style={s.box}>
      <Field
        label="Número do cartão"
        value={value.number}
        onChangeText={(t) => onChange({ ...value, number: maskCardNumber(t) })}
        keyboardType="number-pad"
        autoComplete="cc-number"
        placeholder="0000 0000 0000 0000"
        maxLength={23}
      />
      <View style={s.pair}>
        <View style={{ flex: 1 }}>
          <Field
            label="Validade"
            value={value.expiry}
            onChangeText={(t) => onChange({ ...value, expiry: maskCardExpiry(t) })}
            keyboardType="number-pad"
            placeholder="MM/AA"
            maxLength={5}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Código (CVV)"
            value={value.cvv}
            onChangeText={(t) => onChange({ ...value, cvv: t.replace(/\D/g, '').slice(0, 4) })}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="123"
            maxLength={4}
          />
        </View>
      </View>
      {sandbox ? (
        <Text style={s.hint}>
          Ambiente de testes, nada é cobrado de verdade. Aprovado: 4242 4242 4242 4242 · Recusado:
          4000 0000 0000 0002.
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 8 },
  pair: { flexDirection: 'row', gap: 12 },
  hint: { color: colors.warn, fontSize: 12, fontWeight: '600' },
});
