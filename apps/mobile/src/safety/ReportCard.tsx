import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABEL,
  REPORT_DESCRIPTION_MAX,
  REPORT_DESCRIPTION_MIN,
  type ReportCategory,
} from '@amma/shared';
import { api } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText, Field } from '../ui';
import { Card } from '../driver/components/layout';

/**
 * Canal de denúncia. Com `deliveryId`, a denúncia é sobre a outra parte daquela corrida (o servidor
 * descobre quem é; o app nunca escolhe a pessoa). A resposta da associação chega depois, em "Denúncias".
 */
export function ReportCard({ deliveryId, onClose }: { deliveryId?: string; onClose: () => void }) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent)
    return (
      <Card>
        <Text style={s.title}>Denúncia enviada</Text>
        <Text style={s.muted}>
          A associação vai analisar. Em caso de perigo agora, use o botão de emergência.
        </Text>
        <Button title="Ok" kind="ghost" onPress={onClose} />
      </Card>
    );

  const send = async () => {
    if (!category) return setError('Escolha o que aconteceu.');
    if (description.trim().length < REPORT_DESCRIPTION_MIN)
      return setError(`Conte um pouco mais (pelo menos ${REPORT_DESCRIPTION_MIN} letras).`);
    setBusy(true);
    setError(null);
    try {
      await api('/safety/reports', {
        body: { ...(deliveryId ? { deliveryId } : {}), category, description: description.trim() },
      });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={s.title}>Denunciar</Text>
      <View style={s.chips}>
        {REPORT_CATEGORIES.map((c) => (
          <Pressable
            key={c}
            onPress={() => setCategory(c)}
            accessibilityRole="radio"
            accessibilityState={{ selected: category === c }}
            style={[s.chip, category === c && s.chipOn]}
          >
            <Text style={[s.chipText, category === c && { color: colors.white }]}>
              {REPORT_CATEGORY_LABEL[c]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Field
        label="O que aconteceu?"
        value={description}
        onChangeText={setDescription}
        maxLength={REPORT_DESCRIPTION_MAX}
        multiline
      />
      <ErrorText message={error} />
      <Button title="Enviar denúncia" onPress={send} loading={busy} />
      <Button title="Fechar" kind="ghost" onPress={onClose} disabled={busy} />
    </Card>
  );
}

const s = StyleSheet.create({
  title: { color: colors.black, fontSize: 18, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipText: { color: colors.black, fontSize: 13 },
});
