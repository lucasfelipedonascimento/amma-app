import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';
import { CLIENT_STAGES, clientStage } from '../labels';
import type { ClientDelivery } from '../types';

/** As 4 etapas do pedido, do ponto de vista do cliente. */
export function ClientSteps({
  delivery,
}: {
  delivery: Pick<ClientDelivery, 'status' | 'payment'>;
}) {
  const done = clientStage(delivery);
  return (
    <View style={s.row} accessibilityLabel={`${done} de ${CLIENT_STAGES.length} etapas concluídas`}>
      {CLIENT_STAGES.map((label, i) => {
        const finished = i < done;
        const current = i === done;
        return (
          <View key={label} style={s.step}>
            <View
              testID={`stage-${i}`}
              style={[s.dot, finished && s.done, current && s.current]}
              accessibilityState={{ selected: current, checked: finished }}
            >
              <Text style={[s.dotText, (finished || current) && { color: colors.white }]}>
                {finished ? '✓' : i + 1}
              </Text>
            </View>
            <Text style={[s.label, current && { color: colors.black, fontWeight: '700' }]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: { backgroundColor: colors.ok },
  current: { backgroundColor: colors.red },
  dotText: { color: colors.muted, fontWeight: '800' },
  label: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
