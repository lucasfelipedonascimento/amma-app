import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';
import { DELIVERY_STEPS } from '../steps';

/** As 4 etapas da entrega. `done` = quantas já foram concluídas; a seguinte fica destacada. */
export function StepProgress({ done }: { done: number }) {
  return (
    <View
      style={s.row}
      accessibilityLabel={`${done} de ${DELIVERY_STEPS.length} etapas concluídas`}
    >
      {DELIVERY_STEPS.map((step, i) => {
        const finished = i < done;
        const current = i === done;
        return (
          <View key={step.reaches} style={s.step}>
            <View
              testID={`step-${i}`}
              style={[s.dot, finished && s.dotDone, current && s.dotCurrent]}
              accessibilityState={{ selected: current, checked: finished }}
            >
              <Text style={[s.dotText, (finished || current) && { color: colors.white }]}>
                {finished ? '✓' : i + 1}
              </Text>
            </View>
            <Text style={[s.label, current && { color: colors.black, fontWeight: '700' }]}>
              {step.label}
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
  dotDone: { backgroundColor: colors.ok },
  dotCurrent: { backgroundColor: colors.red },
  dotText: { color: colors.muted, fontWeight: '800' },
  label: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
