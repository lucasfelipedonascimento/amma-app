import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';
import { Button, ErrorText } from './ui';

export interface ReasonOption {
  key: string;
  label: string;
  /** Linha pequena abaixo do motivo (ex.: o que acontece com o pedido). */
  hint?: string;
}

/** Menu de motivos para cancelar: escolhe um motivo e confirma. Usado pelo cliente e pelo motorista. */
export function CancelReasonModal({
  visible,
  title,
  message,
  options,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  options: readonly ReasonOption[];
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (key: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setSelected(null);
  }, [visible]);
  const chosen = options.find((o) => o.key === selected);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.title}>{title}</Text>
          {message ? <Text style={s.message}>{message}</Text> : null}
          <ScrollView style={s.list}>
            {options.map((o) => {
              const on = o.key === selected;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => setSelected(o.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={o.label}
                  style={[s.option, on && s.optionOn]}
                >
                  <View style={[s.radio, on && s.radioOn]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.optionText}>{o.label}</Text>
                    {on && o.hint ? <Text style={s.hint}>{o.hint}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <ErrorText message={error} />
          <Button
            title={confirmLabel}
            kind="danger"
            disabled={!chosen}
            loading={busy}
            onPress={() => chosen && onConfirm(chosen.key)}
          />
          <Button title="Voltar" kind="ghost" onPress={onClose} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 8,
    maxHeight: '85%',
  },
  title: { color: colors.black, fontSize: 20, fontWeight: '800' },
  message: { color: colors.muted, fontSize: 14 },
  list: { flexGrow: 0 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    marginBottom: 8,
  },
  optionOn: { borderColor: colors.red },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
  },
  radioOn: { borderColor: colors.red, backgroundColor: colors.red },
  optionText: { color: colors.black, fontSize: 16, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
