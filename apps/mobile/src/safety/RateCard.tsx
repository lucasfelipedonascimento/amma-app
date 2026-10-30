import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { RATING_COMMENT_MAX } from '@amma/shared';
import { api } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText, Field } from '../ui';
import { RatingStars } from '../client/components/RatingStars';
import { Card } from '../driver/components/layout';

/** Avaliação de 1 a 5 (passageiro avalia motorista e motorista avalia passageiro). */
export function RateCard({
  title,
  path,
  onRated,
  onSkip,
}: {
  title: string;
  /** Rota que recebe `{ stars, comment }`. */
  path: string;
  onRated: () => void;
  onSkip?: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { body: { stars, comment: comment.trim() || undefined } });
      onRated();
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
        maxLength={RATING_COMMENT_MAX}
      />
      <Text style={s.hint}>
        A outra pessoa vê só a média das notas, nunca a sua nota nem o texto.
      </Text>
      <ErrorText message={error} />
      <Button title="Enviar avaliação" onPress={send} loading={busy} disabled={stars === 0} />
      {onSkip ? <Button title="Agora não" kind="ghost" onPress={onSkip} disabled={busy} /> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  title: { color: colors.black, fontSize: 18, fontWeight: '800' },
  hint: { color: colors.muted, fontSize: 12 },
});
