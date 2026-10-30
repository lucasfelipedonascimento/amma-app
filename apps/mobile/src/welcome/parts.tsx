import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText, Field } from '../ui';
import { RatingStars } from '../client/components/RatingStars';
import { Card } from '../driver/components/layout';

/** Várias opções ligáveis (comodidades, filtros). */
export function MultiChips<K extends string>({
  items,
  selected,
  onChange,
}: {
  items: { key: K; label: string }[];
  selected: K[];
  onChange: (next: K[]) => void;
}) {
  return (
    <View style={s.chips}>
      {items.map((i) => {
        const on = selected.includes(i.key);
        return (
          <Pressable
            key={i.key}
            onPress={() =>
              onChange(on ? selected.filter((k) => k !== i.key) : [...selected, i.key])
            }
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            style={[s.chip, on && s.chipOn]}
          >
            <Text style={[s.chipText, on && { color: colors.white }]}>{i.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Nota de 1 a 5 com comentário opcional; manda para `path` e avisa quando termina. */
export function RateCard({
  title,
  path,
  onDone,
}: {
  title: string;
  path: string;
  onDone: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (stars === 0) return setError('Escolha de 1 a 5 estrelas.');
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: { stars, comment: comment.trim() || undefined } });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={s.title}>{title}</Text>
      <RatingStars value={stars} onChange={setStars} />
      <Field
        label="Comentário (opcional)"
        value={comment}
        onChangeText={setComment}
        maxLength={280}
        multiline
      />
      <ErrorText message={error} />
      <Button title="Enviar avaliação" onPress={() => void send()} loading={busy} />
    </Card>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipText: { color: colors.black, fontWeight: '700' },
  title: { color: colors.black, fontWeight: '800', fontSize: 16 },
});
