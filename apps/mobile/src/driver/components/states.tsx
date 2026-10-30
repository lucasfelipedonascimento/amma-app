import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';
import { Button } from '../../ui';

/** Carregando a primeira vez. */
export function LoadingView({ label = 'Carregando…' }: { label?: string }) {
  return (
    <View style={s.center} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.red} size="large" />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

/** Falha ao carregar, com botão para tentar de novo. */
export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={s.center} accessibilityRole="alert">
      <Text style={s.title}>Não deu certo</Text>
      <Text style={s.muted}>{message}</Text>
      <Button title="Tentar de novo" onPress={onRetry} />
    </View>
  );
}

/** Faixa no topo da tela quando o aparelho está sem internet. */
export function OfflineBanner() {
  return (
    <View style={[s.banner, { backgroundColor: colors.black }]} accessibilityRole="alert">
      <Text style={s.bannerText}>Sem internet. Vamos reconectar sozinhos assim que voltar.</Text>
    </View>
  );
}

/** Faixa de aviso (amarela), por exemplo quando o tempo real caiu mas a internet está ok. */
export function WarnBanner({ text }: { text: string }) {
  return (
    <View style={[s.banner, { backgroundColor: colors.warn }]} accessibilityRole="alert">
      <Text style={s.bannerText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.cream,
    justifyContent: 'center',
    alignItems: 'stretch',
    padding: 32,
    gap: 12,
  },
  title: { color: colors.black, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  banner: { paddingVertical: 8, paddingHorizontal: 16, paddingTop: 40 },
  bannerText: { color: colors.white, fontWeight: '600', textAlign: 'center' },
});
