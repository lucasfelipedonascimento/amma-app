import { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../../theme';

/** Página rolável das telas do motorista, com "puxar para atualizar". */
export function Page({
  children,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.pageContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.red} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={s.heading}>{children}</Text>;
}

/** Linha "rótulo ........ valor" dos quadros de valores. */
export function Row({
  label,
  value,
  strong,
  color,
  testID,
}: {
  label: string;
  value: string;
  strong?: boolean;
  color?: string;
  testID?: string;
}) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, strong && s.strong]}>{label}</Text>
      <Text testID={testID} style={[s.rowValue, strong && s.strong, color ? { color } : null]}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.cream },
  pageContent: { padding: 20, paddingTop: 56, paddingBottom: 32, gap: 14 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heading: { color: colors.black, fontSize: 22, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  rowLabel: { color: colors.muted, fontSize: 15, flexShrink: 1 },
  rowValue: { color: colors.black, fontSize: 15, fontVariant: ['tabular-nums'] },
  strong: { color: colors.black, fontWeight: '800', fontSize: 17 },
});
