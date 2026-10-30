import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { Button } from '../ui';
import { ErrorView, LoadingView } from '../driver/components/states';

/** Abas internas da área da associação. */
export function Segments<K extends string>({
  items,
  current,
  onChange,
}: {
  items: { key: K; label: string }[];
  current: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={s.segments} accessibilityRole="tablist">
      {items.map((i) => (
        <Pressable
          key={i.key}
          onPress={() => onChange(i.key)}
          accessibilityRole="tab"
          accessibilityState={{ selected: i.key === current }}
          style={[s.segment, i.key === current && s.segmentOn]}
        >
          <Text style={[s.segmentText, i.key === current && { color: colors.white }]}>
            {i.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Opções em fichas (uma escolhida). */
export function Chips<K extends string | number>({
  items,
  current,
  onChange,
  disabled,
}: {
  items: { key: K; label: string }[];
  current: K | null;
  onChange: (k: K) => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.chips}>
      {items.map((i) => (
        <Pressable
          key={String(i.key)}
          onPress={() => onChange(i.key)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: i.key === current, disabled }}
          style={[s.chip, i.key === current && s.chipOn, disabled && { opacity: 0.5 }]}
        >
          <Text style={[s.chipText, i.key === current && { color: colors.white }]}>{i.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Bar({ percent, testID }: { percent: number; testID?: string }) {
  return (
    <View
      style={s.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
    >
      <View
        testID={testID}
        style={[s.fill, { width: `${Math.max(0, Math.min(100, percent))}%` }]}
      />
    </View>
  );
}

export function Tag({ text, color = colors.muted }: { text: string; color?: string }) {
  return (
    <View style={[s.tag, { borderColor: color }]}>
      <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{text}</Text>
    </View>
  );
}

/** Mostra carregando / erro com "Tentar de novo" / o conteúdo. */
export function Loaded<T>({
  data,
  error,
  onRetry,
  label,
  children,
}: {
  data: T | null;
  error: string | null;
  onRetry: () => void;
  label?: string;
  children: (d: T) => ReactNode;
}) {
  if (data) return <>{children(data)}</>;
  if (error) return <ErrorView message={error} onRetry={onRetry} />;
  return <LoadingView label={label} />;
}

export function BackLink({ onPress }: { onPress: () => void }) {
  return <Button title="‹ Voltar" kind="ghost" onPress={onPress} />;
}

export const muted = { color: colors.muted, fontSize: 14 } as const;
export const strong = { color: colors.black, fontWeight: '800', fontSize: 16 } as const;

const s = StyleSheet.create({
  segments: { flexDirection: 'row', gap: 6 },
  segment: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  segmentOn: { backgroundColor: colors.red, borderColor: colors.red },
  segmentText: { color: colors.black, fontWeight: '700', fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1,
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipText: { color: colors.black, fontWeight: '700' },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 10, backgroundColor: colors.red },
  tag: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
