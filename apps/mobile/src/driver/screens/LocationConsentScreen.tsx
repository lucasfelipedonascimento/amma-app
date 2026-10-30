import { StyleSheet, Text, View } from 'react-native';
import { LOCATION_CONSENT_POINTS } from '@amma/shared';
import { colors } from '../../theme';
import { Button, ErrorText, Screen } from '../../ui';

/**
 * Consentimento de localização (LGPD), mostrado ANTES do pedido de permissão do sistema.
 * O texto vem de `shared` (`LOCATION_CONSENT_POINTS`), junto com a versão registrada na API.
 */
export function LocationConsentScreen({
  busy,
  error,
  onAccept,
  onDecline,
}: {
  busy?: boolean;
  error?: string | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Screen
      title="Sua localização"
      subtitle="Antes de ficar online, entenda como usamos o GPS do seu celular."
    >
      {LOCATION_CONSENT_POINTS.map((p) => (
        <View key={p.title} style={s.point}>
          <Text style={s.pointTitle}>{p.title}</Text>
          <Text style={s.pointText}>{p.text}</Text>
        </View>
      ))}
      <Text style={s.next}>
        Ao continuar, o celular vai pedir a permissão. Escolha “Permitir o tempo todo” para receber
        pedidos com o app fechado.
      </Text>
      <ErrorText message={error} />
      <Button title="Concordo e continuar" onPress={onAccept} loading={busy} />
      <Button title="Agora não" kind="ghost" onPress={onDecline} disabled={busy} />
    </Screen>
  );
}

const s = StyleSheet.create({
  point: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pointTitle: { color: colors.black, fontWeight: '800', fontSize: 16 },
  pointText: { color: colors.black, fontSize: 15 },
  next: { color: colors.muted, fontSize: 14 },
});
