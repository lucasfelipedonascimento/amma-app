import { useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { formatBRL } from '@amma/shared';
import { api } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText, Field } from '../ui';
import { Card, Heading, Row } from '../driver/components/layout';
import { parseReaisToCents } from '../driver/format';
import { BackLink, Bar, Loaded, Tag, muted, strong } from './parts';
import type { Contribution, PurchaseGroupDetail, PurchaseGroupItem } from './types';
import { useLoad } from './useLoad';

const VEHICLE = { MOTO: 'Moto', CARRO: 'Carro' } as const;

/** Compra coletiva: grupos, fila por cotas e tempo, e aportes registrados (parceiro simulado). */
export function PurchaseTab() {
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useLoad<PurchaseGroupItem[]>('/purchase-groups');

  if (openId)
    return (
      <GroupDetail
        id={openId}
        onBack={() => {
          setOpenId(null);
          void list.reload();
        }}
      />
    );
  return (
    <Loaded data={list.data} error={list.error} onRetry={() => void list.reload()}>
      {(groups) =>
        groups.length === 0 ? (
          <Text style={muted}>
            Nenhum grupo de compra aberto ainda. A associação avisa quando abrir um.
          </Text>
        ) : (
          <>
            {groups.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => setOpenId(g.id)}
                accessibilityRole="button"
                accessibilityLabel={g.name}
              >
                <Card>
                  <Text style={strong}>{g.name}</Text>
                  <Text style={muted}>
                    {VEHICLE[g.vehicleType]} · {formatBRL(g.targetCents)} por veículo ·{' '}
                    {g.queueSize} na fila
                  </Text>
                  {g.myStatus === 'NA_FILA' ? (
                    <Tag text="Você está na fila" color={colors.ok} />
                  ) : null}
                  {g.myStatus === 'CONTEMPLADO' ? (
                    <Tag text="Contemplado" color={colors.ok} />
                  ) : null}
                  {g.status === 'ENCERRADO' ? <Tag text="Encerrado" /> : null}
                </Card>
              </Pressable>
            ))}
          </>
        )
      }
    </Loaded>
  );
}

function GroupDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const group = useLoad<PurchaseGroupDetail>(`/purchase-groups/${id}`);
  const mine = useLoad<{ totalCents: number; items: Contribution[] }>(
    `/purchase-groups/${id}/contributions`,
  );
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A mesma chave vale até o aporte ser concluído: duplo toque ou nova tentativa não registra duas vezes.
  const key = useRef(`ap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (join: boolean) =>
    act(async () => {
      await api(`/purchase-groups/${id}/${join ? 'join' : 'leave'}`, { method: 'POST', body: {} });
      await group.reload();
    });

  const contribute = (minCents: number) =>
    act(async () => {
      const cents = parseReaisToCents(amount);
      if (cents === null || cents <= 0) throw new Error('Digite o valor do aporte em reais.');
      if (cents < minCents) throw new Error(`O aporte mínimo é ${formatBRL(minCents)}.`);
      const c = await api<Contribution>(`/purchase-groups/${id}/contributions`, {
        method: 'POST',
        body: { amountCents: cents, idempotencyKey: key.current },
      });
      key.current = `ap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setAmount('');
      setNotice(
        c.status === 'CONFIRMADO'
          ? 'Aporte registrado.'
          : `O parceiro recusou o aporte: ${c.declineReason ?? 'sem motivo informado'}.`,
      );
      await Promise.all([group.reload(), mine.reload()]);
    });

  return (
    <>
      <BackLink onPress={onBack} />
      <Loaded data={group.data} error={group.error} onRetry={() => void group.reload()}>
        {(g) => {
          const me = g.queue.find((q) => q.isMe);
          const inQueue = g.myStatus === 'NA_FILA';
          const funded = Math.min(100, Math.round((g.fundedCents / g.targetCents) * 100));
          return (
            <>
              <Heading>{g.name}</Heading>
              {g.description ? <Text style={muted}>{g.description}</Text> : null}
              <Card>
                <Row label="Veículo" value={VEHICLE[g.vehicleType]} />
                <Row label="Valor de um veículo" value={formatBRL(g.targetCents)} />
                <Row label="Aportes confirmados" value={formatBRL(g.fundedCents)} testID="funded" />
                <Bar percent={funded} />
                <Text style={muted}>
                  Contemplações possíveis agora: {g.availableUnits}. Quem é contemplado é o primeiro
                  da fila, decidido pela associação.
                </Text>
              </Card>

              <Card>
                <Text style={strong}>Fila</Text>
                <Text style={muted}>
                  Ordem por pontos: {g.rules.quotaWeight} por cota + {g.rules.dayWeight} por dia de
                  fila. Esses pesos são decididos em assembleia.
                </Text>
                {g.queue.length === 0 ? <Text style={muted}>Ninguém na fila ainda.</Text> : null}
                {g.queue.map((q) => (
                  <Row
                    key={q.position}
                    label={`${q.position}º ${q.name}${q.isMe ? ' (você)' : ''}`}
                    value={`${q.score} pts`}
                    strong={q.isMe}
                    testID={q.isMe ? 'my-position' : undefined}
                  />
                ))}
                {me ? (
                  <Text style={muted}>
                    Você: {me.quotas} cotas e {me.daysInQueue} dia(s) de fila.
                  </Text>
                ) : null}
                {g.awards.map((a) => (
                  <Text key={a.position} style={{ color: colors.ok }}>
                    Contemplado: {a.name}
                    {a.isMe ? ' (você)' : ''}
                  </Text>
                ))}
                {g.status === 'ABERTO' && g.myStatus !== 'CONTEMPLADO' ? (
                  inQueue ? (
                    <Button
                      title="Sair da fila"
                      kind="ghost"
                      onPress={() => void toggle(false)}
                      loading={busy}
                    />
                  ) : (
                    <Button
                      title="Entrar na fila"
                      onPress={() => void toggle(true)}
                      loading={busy}
                    />
                  )
                ) : null}
              </Card>

              {g.myStatus === 'NA_FILA' || g.myStatus === 'CONTEMPLADO' ? (
                <Card>
                  <Text style={strong}>Meus aportes</Text>
                  <Text style={muted}>
                    SIMULAÇÃO: nenhum dinheiro é movimentado. Num grupo real, o pagamento seria
                    feito ao parceiro regulado (consórcio ou cooperativa de crédito) e a AMMA só
                    registra.
                  </Text>
                  <Row
                    label="Total aportado"
                    value={formatBRL(mine.data?.totalCents ?? 0)}
                    testID="my-total"
                  />
                  {mine.data?.items.map((c) => (
                    <Row
                      key={c.id}
                      label={c.status === 'CONFIRMADO' ? 'Confirmado' : 'Recusado'}
                      value={formatBRL(c.amountCents)}
                      color={c.status === 'CONFIRMADO' ? colors.ok : colors.red}
                    />
                  ))}
                  {g.status === 'ABERTO' ? (
                    <>
                      <Field
                        label="Valor do aporte (R$)"
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="decimal-pad"
                        placeholder={`mínimo ${formatBRL(g.rules.minContributionCents)}`}
                      />
                      <Button
                        title="Registrar aporte"
                        onPress={() => void contribute(g.rules.minContributionCents)}
                        loading={busy}
                      />
                    </>
                  ) : null}
                </Card>
              ) : null}
              {notice ? (
                <Text style={{ color: colors.ok, fontWeight: '600' }}>{notice}</Text>
              ) : null}
              <ErrorText message={error} />
            </>
          );
        }}
      </Loaded>
    </>
  );
}
