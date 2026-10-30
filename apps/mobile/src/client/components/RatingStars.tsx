import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RATING_STARS } from '@amma/shared';
import { colors } from '../../theme';

/** 1 a 5 estrelas. Sem `onChange` é só leitura. */
export function RatingStars({
  value,
  onChange,
}: {
  value: number;
  onChange?: (n: number) => void;
}) {
  return (
    <View
      style={s.row}
      accessibilityRole={onChange ? 'radiogroup' : 'text'}
      accessibilityLabel={`Nota ${value} de 5`}
    >
      {RATING_STARS.map((n) => (
        <Pressable
          key={n}
          disabled={!onChange}
          onPress={() => onChange?.(n)}
          accessibilityRole="radio"
          accessibilityLabel={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
          accessibilityState={{ selected: n === value }}
          hitSlop={6}
        >
          <Text testID={`star-${n}`} style={[s.star, n <= value && s.on]}>
            ★
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  star: { fontSize: 36, color: colors.border },
  on: { color: colors.red },
});
