import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { HOST_BENEFIT_KINDS, type HostBenefitKind } from '@amma/shared';
import { API_URL, api, getAccessToken, uploadFile } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText } from '../ui';
import { BackLink, Chips, Loaded, Tag, muted, strong } from '../association/parts';
import { useLoad } from '../association/useLoad';
import { Card, Row } from '../driver/components/layout';
import { formatDateTime, formatRating } from '../driver/format';
import { STATUS_LABEL, TYPE_LABEL } from './labels';
import { RateCard } from './parts';
import type { VisitItem, WelcomePointView } from './types';

const STATUS_COLOR = {
  ATIVO: colors.ok,
  EM_ANALISE: colors.warn,
  SUSPENSO: colors.red,
  RECUSADO: colors.red,
  REMOVIDO: colors.muted,
} as const;

/** Pontos cadastrados por você: situação, fotos, benefício e avaliação dos visitantes. */
export function MineTab() {
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useLoad<WelcomePointView[]>('/welcome-points/mine');
  if (openId)
    return (
      <Manage
        id={openId}
        onBack={() => {
          setOpenId(null);
          void list.reload();
        }}
      />
    );
  return (
    <Loaded data={list.data} error={list.error} onRetry={() => void list.reload()}>
      {(points) =>
        points.length === 0 ? (
          <Text style={muted}>Você ainda não cadastrou nenhum ponto. Use a aba “Cadastrar”.</Text>
        ) : (
          <>
            {points.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setOpenId(p.id)}
                accessibilityRole="button"
                accessibilityLabel={p.name}
              >
                <Card>
                  <Text style={strong}>{p.name}</Text>
                  <Text style={muted}>
                    {TYPE_LABEL[p.type]} · {p.neighborhood}
                  </Text>
                  {p.status ? (
                    <Tag text={STATUS_LABEL[p.status]} color={STATUS_COLOR[p.status]} />
                  ) : null}
                  {p.statusNote && p.status !== 'ATIVO' ? (
                    <Text style={muted}>{p.statusNote}</Text>
                  ) : null}
                </Card>
              </Pressable>
            ))}
          </>
        )
      }
    </Loaded>
  );
}

function Manage({ id, onBack }: { id: string; onBack: () => void }) {
  const point = useLoad<WelcomePointView>(`/welcome-points/${id}`);
  const visits = useLoad<VisitItem[]>(`/welcome-points/${id}/visits`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addPhoto = () =>
    act(async () => {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) throw new Error('Não foi possível ler a foto escolhida. Tente outra.');
      await uploadFile(`/welcome-points/${id}/photos`, {
        uri: asset.uri,
        mimeType: asset.mimeType,
      });
      await point.reload();
    });

  const setBenefit = (kind: HostBenefitKind) =>
    act(async () => {
      await api(`/welcome-points/${id}`, { method: 'PATCH', body: { benefitKind: kind } });
      await point.reload();
    });

  const remove = () =>
    act(async () => {
      await api(`/welcome-points/${id}`, { method: 'DELETE' });
      onBack();
    });

  return (
    <>
      <BackLink onPress={onBack} />
      <Loaded data={point.data} error={point.error} onRetry={() => void point.reload()}>
        {(p) => (
          <>
            <Card>
              <Text style={strong}>{p.name}</Text>
              {p.status ? (
                <Tag text={STATUS_LABEL[p.status]} color={STATUS_COLOR[p.status]} />
              ) : null}
              {p.statusNote ? <Text style={muted}>{p.statusNote}</Text> : null}
              <Row label="Avaliação" value={formatRating(p.rating)} />
              <Row label="Agora" value={`${p.occupied} de ${p.capacity} pessoas`} />
              <Text style={muted}>
                {p.address}
                {p.reference ? ` (${p.reference})` : ''}
              </Text>
            </Card>

            <Card>
              <Text style={strong}>Fotos ({p.photos.length}/6)</Text>
              <View style={s.photos}>
                {p.photos.map((photo) => (
                  <Image
                    key={photo}
                    source={{
                      uri: `${API_URL}/welcome-points/${p.id}/photos/${photo}`,
                      headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
                    }}
                    style={s.photo}
                    accessibilityLabel="Foto do ponto"
                  />
                ))}
              </View>
              <Button
                title="Enviar foto"
                kind="ghost"
                onPress={() => void addPhoto()}
                loading={busy}
              />
            </Card>

            {p.type === 'CASA_PARCEIRA' ? (
              <Card>
                <Text style={strong}>Benefício por visita</Text>
                <Chips
                  items={HOST_BENEFIT_KINDS.map((k) => ({
                    key: k,
                    label: k === 'CREDITO' ? 'Crédito no saldo' : 'Desconto nas taxas',
                  }))}
                  current={p.benefitKind ?? null}
                  onChange={(k) => void setBenefit(k)}
                  disabled={busy}
                />
              </Card>
            ) : null}

            {p.hasHost ? (
              <Card>
                <Text style={strong}>Visitas recentes</Text>
                <Loaded
                  data={visits.data}
                  error={visits.error}
                  onRetry={() => void visits.reload()}
                >
                  {(list) =>
                    list.length === 0 ? (
                      <Text style={muted}>Ninguém visitou ainda.</Text>
                    ) : (
                      <>
                        {list.map((v) => (
                          <View key={v.id} style={{ gap: 6 }}>
                            <Text style={{ color: colors.black }}>
                              {v.visitorName} · {formatDateTime(v.endedAt)} · {v.minutes} min ·{' '}
                              {formatRating(v.visitorRating)}
                            </Text>
                            {v.canRate && rating !== v.id ? (
                              <Button
                                title={`Avaliar ${v.visitorName}`}
                                kind="ghost"
                                onPress={() => setRating(v.id)}
                              />
                            ) : null}
                            {v.rated ? <Tag text="Avaliado" color={colors.ok} /> : null}
                            {rating === v.id ? (
                              <RateCard
                                title={`Como foi receber ${v.visitorName}?`}
                                path={`/welcome-points/check-ins/${v.id}/rate-visitor`}
                                onDone={() => {
                                  setRating(null);
                                  void visits.reload();
                                }}
                              />
                            ) : null}
                          </View>
                        ))}
                      </>
                    )
                  }
                </Loaded>
              </Card>
            ) : null}

            <ErrorText message={error} />
            {p.status !== 'REMOVIDO' && p.status !== 'RECUSADO' ? (
              confirmRemove ? (
                <Button
                  title="Confirmar: remover este ponto"
                  kind="danger"
                  onPress={() => void remove()}
                  loading={busy}
                />
              ) : (
                <Button title="Remover ponto" kind="ghost" onPress={() => setConfirmRemove(true)} />
              )
            ) : null}
          </>
        )}
      </Loaded>
    </>
  );
}

const s = StyleSheet.create({
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 90, height: 90, borderRadius: 10, backgroundColor: colors.border },
});
