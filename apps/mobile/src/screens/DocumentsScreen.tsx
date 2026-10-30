import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Text, View } from 'react-native';
import type { DocumentType } from '@amma/shared';
import { ApiError, uploadFile } from '../api';
import { colors } from '../theme';
import { Button, ErrorText, Screen } from '../ui';

const ITEMS: { type: DocumentType; title: string }[] = [
  { type: 'CNH', title: 'CNH (frente e verso legíveis)' },
  { type: 'DOCUMENTO_VEICULO', title: 'Documento do veículo (CRLV)' },
  { type: 'FOTO', title: 'Foto do seu rosto' },
];

/** Envio dos documentos. Cada envio novo substitui o anterior na análise. */
export function DocumentsScreen({
  vehicleId,
  sent,
  onDone,
}: {
  vehicleId: string;
  sent: DocumentType[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<DocumentType | null>(null);
  // Erro de cada item aparece no próprio cartão (antes ficava no fim da tela, fora da vista).
  const [errors, setErrors] = useState<Partial<Record<DocumentType, string>>>({});
  const [done, setDone] = useState<DocumentType[]>(sent);

  const fail = (type: DocumentType, message: string) =>
    setErrors((e) => ({ ...e, [type]: message }));

  const pick = async (type: DocumentType, camera: boolean) => {
    setErrors((e) => ({ ...e, [type]: undefined }));
    setBusy(type);
    try {
      // A galeria usa o seletor do próprio sistema e não precisa de permissão; só a câmera precisa.
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted)
          return fail(type, 'Permissão da câmera negada. Libere nas configurações do celular.');
      }
      const res = camera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) return fail(type, 'Não foi possível ler a foto escolhida. Tente outra.');
      await uploadFile(
        '/driver/documents',
        { uri: asset.uri, mimeType: asset.mimeType },
        { type, ...(type === 'DOCUMENTO_VEICULO' ? { vehicleId } : {}) },
      );
      setDone((d) => [...new Set([...d, type])]);
    } catch (e) {
      fail(
        type,
        e instanceof ApiError
          ? e.message
          : `Erro ao anexar: ${e instanceof Error ? e.message : 'inesperado'}`,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title="Documentos" subtitle="Envie fotos nítidas. Arquivos JPG ou PNG de até 5 MB.">
      {ITEMS.map((it) => (
        <View
          key={it.type}
          style={{
            backgroundColor: colors.white,
            borderRadius: 12,
            padding: 14,
            gap: 8,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontWeight: '700', color: colors.black }}>{it.title}</Text>
          <Text style={{ color: done.includes(it.type) ? colors.ok : colors.muted }}>
            {busy === it.type
              ? 'Enviando…'
              : done.includes(it.type)
                ? 'Enviado ✓'
                : 'Ainda não enviado'}
          </Text>
          <ErrorText message={errors[it.type]} />
          <Button
            title="Tirar foto"
            loading={busy === it.type}
            disabled={busy !== null}
            onPress={() => pick(it.type, true)}
          />
          <Button
            title="Escolher da galeria"
            kind="ghost"
            disabled={busy !== null}
            onPress={() => pick(it.type, false)}
          />
        </View>
      ))}
      <Button title="Ver estado da aprovação" kind="danger" onPress={onDone} />
    </Screen>
  );
}
