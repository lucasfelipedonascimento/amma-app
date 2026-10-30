import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text } from 'react-native';
import * as Location from 'expo-location';
import { api } from '../../api';
import { colors } from '../../theme';
import { Button } from '../../ui';

/** Telefone da central da associação (opcional). Sem ele, só os números públicos aparecem. */
const SUPPORT_PHONE = process.env.EXPO_PUBLIC_AMMA_SUPPORT_PHONE;

const call = (number: string) => Linking.openURL(`tel:${number}`);

/** Última posição conhecida, sem pedir permissão nem esperar GPS: em emergência, rápido vale mais que exato. */
async function quickPosition(): Promise<{ lat: number; lng: number } | undefined> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return undefined;
    const p = await Location.getLastKnownPositionAsync();
    return p ? { lat: p.coords.latitude, lng: p.coords.longitude } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Botão de emergência (passageiro e motorista). Pede confirmação (para não ser tocado sem querer),
 * AVISA A ASSOCIAÇÃO com a corrida e a última posição, e liga para quem socorre. Se o aviso falhar
 * (sem internet), a ligação continua: o telefone vem primeiro.
 */
export function EmergencyButton({
  deliveryId,
  compact,
}: {
  deliveryId?: string;
  /** Botão pequeno para a tela do mapa; o resultado do aviso aparece num alerta. */
  compact?: boolean;
}) {
  const [note, setNoteState] = useState<string | null>(null);
  const setNote = (v: string) => {
    if (compact) {
      if (!v.endsWith('…')) Alert.alert('Emergência', v);
    } else setNoteState(v);
  };

  const notify = async () => {
    setNote('Avisando a associação…');
    try {
      const where = await quickPosition();
      await api('/safety/emergency', { body: { ...(deliveryId ? { deliveryId } : {}), ...where } });
      setNote('A associação foi avisada. Se puder, ligue para o 190.');
    } catch {
      setNote('Não conseguimos avisar a associação agora. Ligue para o 190.');
    }
  };
  const callAndNotify = (number: string) => {
    void notify();
    void call(number);
  };

  const open = () =>
    Alert.alert('Emergência', 'Quem você quer chamar agora? A associação também será avisada.', [
      { text: 'Polícia — 190', onPress: () => callAndNotify('190') },
      { text: 'SAMU — 192', onPress: () => callAndNotify('192') },
      { text: 'Bombeiros — 193', onPress: () => callAndNotify('193') },
      ...(SUPPORT_PHONE
        ? [{ text: 'Central da AMMA', onPress: () => callAndNotify(SUPPORT_PHONE) }]
        : []),
      { text: 'Só avisar a associação', onPress: () => void notify() },
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  return (
    <>
      <Button
        title={compact ? '🚨 SOS' : '🚨 Emergência'}
        kind="danger"
        size={compact ? 'sm' : 'md'}
        onPress={open}
      />
      {note ? <Text style={s.note}>{note}</Text> : null}
    </>
  );
}

const s = StyleSheet.create({
  note: { color: colors.muted, fontSize: 13, textAlign: 'center' },
});
