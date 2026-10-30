import { Alert, Linking } from 'react-native';
import { Button } from '../../ui';

/** Telefone da central da associação (opcional). Sem ele, só os números públicos aparecem. */
const SUPPORT_PHONE = process.env.EXPO_PUBLIC_AMMA_SUPPORT_PHONE;

const call = (number: string) => Linking.openURL(`tel:${number}`);

/**
 * Botão de emergência: pede confirmação (para não ser tocado sem querer) e liga para quem socorre.
 * Ainda NÃO avisa a associação nem o cliente — isso depende de um canal que não existe (docs/PROGRESSO.md).
 */
export function EmergencyButton() {
  const open = () =>
    Alert.alert('Emergência', 'Quem você quer chamar agora?', [
      { text: 'Polícia — 190', onPress: () => void call('190') },
      { text: 'SAMU — 192', onPress: () => void call('192') },
      { text: 'Bombeiros — 193', onPress: () => void call('193') },
      ...(SUPPORT_PHONE
        ? [{ text: 'Central da AMMA', onPress: () => void call(SUPPORT_PHONE) }]
        : []),
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  return <Button title="🚨 Emergência" kind="danger" onPress={open} />;
}
