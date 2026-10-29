import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Text, View } from 'react-native';
import type { DocumentType } from '@amma/shared';
import { ApiError, api } from '../api';
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
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DocumentType[]>(sent);

  const pick = async (type: DocumentType, camera: boolean) => {
    setError(null);
    const perm = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted)
      return setError('Permissão negada. Libere o acesso nas configurações do celular.');
    const res = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return;
    const asset = res.assets[0];
    const form = new FormData();
    form.append('type', type);
    if (type === 'DOCUMENTO_VEICULO') form.append('vehicleId', vehicleId);
    form.append('file', {
      uri: asset.uri,
      name: asset.fileName ?? 'documento.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    } as unknown as Blob);
    setBusy(type);
    try {
      await api('/driver/documents', { form });
      setDone((d) => [...new Set([...d, type])]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro inesperado');
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
            {done.includes(it.type) ? 'Enviado ✓' : 'Ainda não enviado'}
          </Text>
          <Button
            title="Tirar foto"
            loading={busy === it.type}
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
      <ErrorText message={error} />
      <Button title="Ver estado da aprovação" kind="danger" onPress={onDone} />
    </Screen>
  );
}
