import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { POINT_REPORT_CATEGORIES, type PointReportCategory } from '@amma/shared';
import { API_URL, api, getAccessToken } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText, Field } from '../ui';
import { BackLink, Chips, Loaded, Tag, muted, strong } from '../association/parts';
import { useLoad } from '../association/useLoad';
import { Card, Row } from '../driver/components/layout';
import { formatRating } from '../driver/format';
import {
  AMENITY_LABEL,
  REPORT_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  describeHours,
  formatKm,
} from './labels';
import { whereAmI } from './position';
import type { Position, WelcomePointView } from './types';

/** Um ponto: informações, fotos, check-in (perto do local) e denúncia. */
export function PointDetail({
  id,
  pos,
  onBack,
  onCheckedIn,
}: {
  id: string;
  pos: Position;
  onBack: () => void;
  onCheckedIn: () => void;
}) {
  const point = useLoad<WelcomePointView>(`/welcome-points/${id}?lat=${pos.lat}&lng=${pos.lng}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const checkIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const here = await whereAmI();
      await api(`/welcome-points/${id}/check-in`, { method: 'POST', body: here });
      onCheckedIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BackLink onPress={onBack} />
      <Loaded data={point.data} error={point.error} onRetry={() => void point.reload()}>
        {(p) => (
          <>
            <Card>
              <Text style={strong}>{p.name}</Text>
              <View style={s.tags}>
                <Tag text={TYPE_LABEL[p.type]} />
                <Tag
                  text={p.openNow ? 'Aberto agora' : 'Fechado agora'}
                  color={p.openNow ? colors.ok : colors.muted}
                />
                {p.status && p.status !== 'ATIVO' ? (
                  <Tag text={STATUS_LABEL[p.status]} color={colors.warn} />
                ) : null}
              </View>
              {p.description ? <Text style={muted}>{p.description}</Text> : null}
              <Row label="Bairro" value={p.neighborhood} />
              {p.distanceMeters !== undefined ? (
                <Row label="Distância" value={formatKm(p.distanceMeters)} />
              ) : null}
              <Row label="Horário" value={describeHours(p.hours)} />
              <Row label="Vagas" value={`${p.occupied} de ${p.capacity} ocupadas`} />
              <Row label="Avaliação" value={formatRating(p.rating)} />
              <Text style={muted}>{p.amenities.map((a) => AMENITY_LABEL[a]).join(' · ')}</Text>
              {p.address ? (
                <Text style={strong}>
                  {p.address}
                  {p.reference ? ` (${p.reference})` : ''}
                </Text>
              ) : (
                <Text style={muted}>
                  Esta é a casa de alguém: o endereço completo aparece quando você fizer o check-in.
                  A posição no mapa é aproximada.
                </Text>
              )}
            </Card>

            {p.photos.length > 0 ? (
              <View style={s.photos}>
                {p.photos.map((photo) => (
                  <Image
                    key={photo}
                    source={{
                      uri: `${API_URL}/welcome-points/${p.id}/photos/${photo}`,
                      headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
                    }}
                    style={s.photo}
                    accessibilityLabel={`Foto de ${p.name}`}
                  />
                ))}
              </View>
            ) : null}

            {notice ? <Text style={{ color: colors.ok, fontWeight: '700' }}>{notice}</Text> : null}
            <ErrorText message={error} />
            {p.isOwner ? (
              <Text style={muted}>Este ponto é seu. Gerencie em “Meus pontos”.</Text>
            ) : (
              <>
                <Button
                  title="Fazer check-in aqui"
                  onPress={() => void checkIn()}
                  loading={busy}
                  disabled={!p.openNow || p.occupied >= p.capacity}
                />
                <Text style={muted}>
                  Você precisa estar a até 200 m do ponto. Ficando 5 minutos ou mais, a visita conta
                  e você pode avaliar o lugar.
                </Text>
                {reporting ? (
                  <ReportForm
                    id={p.id}
                    onDone={() => {
                      setReporting(false);
                      setNotice('Denúncia enviada. A associação vai analisar.');
                      void point.reload();
                    }}
                    onCancel={() => setReporting(false)}
                  />
                ) : (
                  <Button
                    title="Denunciar este ponto"
                    kind="ghost"
                    onPress={() => setReporting(true)}
                  />
                )}
              </>
            )}
          </>
        )}
      </Loaded>
    </>
  );
}

function ReportForm({
  id,
  onDone,
  onCancel,
}: {
  id: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<PointReportCategory | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!category) return setError('Escolha o motivo da denúncia.');
    setBusy(true);
    setError(null);
    try {
      await api(`/welcome-points/${id}/reports`, {
        method: 'POST',
        body: { category, text: text.trim() || undefined },
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={strong}>O que aconteceu?</Text>
      <Chips
        items={POINT_REPORT_CATEGORIES.map((c) => ({ key: c, label: REPORT_LABEL[c] }))}
        current={category}
        onChange={setCategory}
      />
      <Field
        label="Conte com detalhes (opcional)"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={1000}
      />
      <ErrorText message={error} />
      <Button title="Enviar denúncia" onPress={() => void send()} loading={busy} />
      <Button title="Cancelar" kind="ghost" onPress={onCancel} />
    </Card>
  );
}

const s = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 100, height: 100, borderRadius: 10, backgroundColor: colors.border },
});
