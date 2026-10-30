import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { colors } from './theme';

export function Screen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.brand}>AMMA</Text>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      {children}
    </ScrollView>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={s.input}
        accessibilityLabel={label}
        {...props}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  size = 'md',
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  /** `sm`: botão baixo, para painéis sobre o mapa. */
  size?: 'md' | 'sm';
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy: loading }}
      style={[
        s.btn,
        size === 'sm' && s.btnSm,
        kind === 'primary' && s.btnPrimary,
        kind === 'danger' && s.btnDanger,
        kind === 'ghost' && s.btnGhost,
        off && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'ghost' ? colors.red : colors.white} />
      ) : (
        <Text
          style={[
            s.btnText,
            size === 'sm' && s.btnTextSm,
            kind === 'ghost' && { color: colors.red },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export const ErrorText = ({ message }: { message?: string | null }) =>
  message ? <Text style={s.error}>{message}</Text> : null;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { padding: 24, paddingTop: 64, gap: 12 },
  brand: { color: colors.red, fontSize: 28, fontWeight: '800', letterSpacing: 2 },
  title: { color: colors.black, fontSize: 24, fontWeight: '700', marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 15, marginBottom: 8 },
  field: { gap: 4 },
  label: { color: colors.black, fontWeight: '600' },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.black,
  },
  btn: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  btnSm: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 4, marginTop: 0 },
  btnTextSm: { fontSize: 12 },
  btnPrimary: { backgroundColor: colors.red },
  btnDanger: { backgroundColor: colors.black },
  btnGhost: { borderWidth: 1, borderColor: colors.red },
  btnText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  error: { color: colors.red, fontWeight: '600' },
});
