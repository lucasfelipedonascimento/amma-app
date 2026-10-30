import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';

export interface Tab<K extends string> {
  key: K;
  label: string;
  /** Bolinha de aviso (ex.: entrega em andamento). */
  badge?: boolean;
}

export function TabBar<K extends string>({
  tabs,
  current,
  onChange,
}: {
  tabs: Tab<K>[];
  current: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={s.bar} accessibilityRole="tablist">
      {tabs.map((t) => (
        <Pressable
          key={t.key}
          onPress={() => onChange(t.key)}
          accessibilityRole="tab"
          accessibilityState={{ selected: t.key === current }}
          style={s.tab}
        >
          <Text style={[s.label, t.key === current && s.on]}>{t.label}</Text>
          {t.badge ? <View style={s.badge} testID={`badge-${t.key}`} /> : null}
          {t.key === current ? <View style={s.underline} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 12,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  label: { color: colors.muted, fontWeight: '600', fontSize: 14 },
  on: { color: colors.red, fontWeight: '800' },
  underline: { position: 'absolute', top: 0, height: 3, width: '50%', backgroundColor: colors.red },
  badge: {
    position: 'absolute',
    top: 10,
    right: '22%',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.red,
  },
});
