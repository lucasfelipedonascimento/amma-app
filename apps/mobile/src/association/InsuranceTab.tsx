import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { formatBRL, isClaimFinal, maskDate, parseBrDate } from '@amma/shared';
import { ApiError, api, uploadFile } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText, Field } from '../ui';
import { Card, Heading, Row } from '../driver/components/layout';
import { formatDateTime, parseReaisToCents } from '../driver/format';
import { BackLink, Chips, Loaded, Tag, muted, strong } from './parts';
import { CLAIM_KIND_LABEL, CLAIM_STATUS_LABEL } from './labels';
import type { Claim, ClaimKind } from './types';
import { useLoad } from './useLoad';

const statusColor = (s: Claim['status']) =>
  s === 'APROVADA' ? colors.ok : s === 'NEGADA' ? colors.red : colors.muted;

/** Seguro mútuo: pedir, anexar comprovantes, acompanhar e ver a decisão (sempre de uma pessoa da associação). */
export function InsuranceTab() {
  const [view, setView] = useState<'list' | 'new' | string>('list');
  const list = useLoad<Claim[]>('/insurance/claims');

  if (view === 'new')
    return (
      <NewClaim
        onBack={() => setView('list')}
        onCreated={(id) => {
          void list.reload();
          setView(id);
        }}
      />
    );
  if (view !== 'list')
    return (
      <ClaimDetail
        id={view}
        onBack={() => {
          setView('list');
          void list.reload();
        }}
      />
    );
  return (
    <>
      <Button title="Novo pedido de seguro" onPress={() => setView('new')} />
      <Loaded data={list.data} error={list.error} onRetry={() => void list.reload()}>
        {(claims) =>
          claims.length === 0 ? (
            <Text style={muted}>Você ainda não fez nenhum pedido.</Text>
          ) : (
            <>
              {claims.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setView(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Pedido ${CLAIM_KIND_LABEL[c.kind]}`}
                >
                  <Card>
                    <Text style={strong}>
                      {CLAIM_KIND_LABEL[c.kind]} · {formatBRL(c.requestedCents)}
                    </Text>
                    <Tag text={CLAIM_STATUS_LABEL[c.status]} color={statusColor(c.status)} />
                    <Text style={muted}>Enviado em {formatDateTime(c.createdAt)}</Text>
                  </Card>
                </Pressable>
              ))}
            </>
          )
        }
      </Loaded>
    </>
  );
}

function NewClaim({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<ClaimKind>('ACIDENTE');
  const [date, setDate] = useState('');
  const [text, setText] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const iso = parseBrDate(date);
    const cents = parseReaisToCents(value);
    if (!iso) return setError('Digite a data do ocorrido, no formato dd/mm/aaaa.');
    if (text.trim().length < 10) return setError('Conte o que aconteceu (pelo menos 10 letras).');
    if (cents === null || cents <= 0)
      return setError('Digite o valor que você está pedindo, em reais.');
    setBusy(true);
    setError(null);
    try {
      const c = await api<Claim>('/insurance/claims', {
        method: 'POST',
        body: {
          kind,
          occurredAt: new Date(`${iso}T12:00:00-03:00`).toISOString(),
          description: text.trim(),
          requestedCents: cents,
        },
      });
      onCreated(c.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BackLink onPress={onBack} />
      <Heading>Novo pedido de seguro</Heading>
      <Text style={muted}>
        Depois de enviar, você anexa fotos e documentos. Uma pessoa da associação analisa e decide.
      </Text>
      <Chips
        items={(Object.keys(CLAIM_KIND_LABEL) as ClaimKind[]).map((k) => ({
          key: k,
          label: CLAIM_KIND_LABEL[k],
        }))}
        current={kind}
        onChange={setKind}
      />
      <Field
        label="Quando aconteceu"
        value={date}
        onChangeText={(t) => setDate(maskDate(t))}
        keyboardType="number-pad"
        placeholder="dd/mm/aaaa"
      />
      <Field
        label="O que aconteceu"
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={4}
      />
      <Field
        label="Valor pedido (R$)"
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
      />
      <ErrorText message={error} />
      <Button title="Enviar pedido" onPress={() => void submit()} loading={busy} />
    </>
  );
}

function ClaimDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, reload } = useLoad<Claim>(`/insurance/claims/${id}`);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const attach = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) throw new Error('Não foi possível ler a foto escolhida. Tente outra.');
      await uploadFile(`/insurance/claims/${id}/attachments`, {
        uri: asset.uri,
        mimeType: asset.mimeType,
      });
      await reload();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api(`/insurance/claims/${id}/cancel`, { method: 'POST', body: {} });
      await reload();
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BackLink onPress={onBack} />
      <Loaded data={data} error={error} onRetry={() => void reload()}>
        {(c) => (
          <>
            <Heading>{CLAIM_KIND_LABEL[c.kind]}</Heading>
            <Tag text={CLAIM_STATUS_LABEL[c.status]} color={statusColor(c.status)} />
            <Card>
              <Row label="Valor pedido" value={formatBRL(c.requestedCents)} />
              {c.approvedCents !== null ? (
                <Row
                  label="Valor aprovado"
                  value={formatBRL(c.approvedCents)}
                  strong
                  color={colors.ok}
                  testID="approved"
                />
              ) : null}
              <Text style={{ color: colors.black }}>{c.description}</Text>
              <Text style={muted}>Anexos: {c.attachments.length}</Text>
            </Card>
            {c.decisionNote ? (
              <Card>
                <Text style={strong}>Decisão da associação</Text>
                <Text style={{ color: colors.black }}>{c.decisionNote}</Text>
              </Card>
            ) : null}
            <Card>
              <Text style={strong}>Acompanhamento</Text>
              {c.timeline.map((e, i) => (
                <Text key={i} style={muted}>
                  {formatDateTime(e.at)} · {CLAIM_STATUS_LABEL[e.to]}
                </Text>
              ))}
            </Card>
            {!isClaimFinal(c.status) ? (
              <>
                <Button
                  title="Anexar foto"
                  kind="ghost"
                  onPress={() => void attach()}
                  loading={busy}
                />
                <Button
                  title="Cancelar pedido"
                  kind="danger"
                  onPress={() => void cancel()}
                  disabled={busy}
                />
              </>
            ) : null}
            <ErrorText message={problem} />
          </>
        )}
      </Loaded>
    </>
  );
}
