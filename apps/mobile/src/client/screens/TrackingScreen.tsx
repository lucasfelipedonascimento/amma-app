import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { clientCancelOptions, formatBRL } from '@amma/shared';
import { CancelReasonModal } from '../../CancelReasonModal';
import { api } from '../../api';
import { errorMessage } from '../../errors';
import { colors } from '../../theme';
import { Button, ErrorText, Field } from '../../ui';
import { Card, Heading, Page, Row } from '../../driver/components/layout';
import { ErrorView, LoadingView, OfflineBanner, WarnBanner } from '../../driver/components/states';
import { formatDistance, formatDuration } from '../../driver/format';
import { useClient } from '../ClientProvider';
import { ClientSteps } from '../components/ClientSteps';
import { DeliveryMap } from '../components/DeliveryMap';
import { PixPanel } from '../components/PixPanel';
import { DriverCheckCard, RideSafetyCard } from '../components/RideSafety';
import { RatingStars } from '../components/RatingStars';
import { useLiveDelivery } from '../hooks';
import {
  cancelText,
  METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  canClientCancel,
  statusText,
} from '../labels';
import { paymentLine } from '../receiptText';
import type { ClientDelivery } from '../types';

/** Acompanhamento em tempo real: estado, mapa com o motorista, pagamento, cancelamento, avaliação e recibo. */
export function TrackingScreen({
  id,
  onBack,
  onReceipt,
}: {
  id: string;
  onBack: () => void;
  onReceipt: () => void;
}) {
  const { delivery: d, error, reload, driverAt } = useLiveDelivery(id);
  const { realtime, offline, reloadDeliveries } = useClient();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!d)
    return error ? (
      <ErrorView message={error} onRetry={() => void reload()} />
    ) : (
      <LoadingView label="Carregando o pedido…" />
    );

  const ride = d.kind === 'CORRIDA';
  const what = ride ? 'corrida' : 'pedido';
  const confirmCancel = async (category: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/deliveries/${id}/cancel`, { body: { reason: 'CLIENTE_DESISTIU', category } });
      setCancelOpen(false);
      await reload();
      void reloadDeliveries();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pixPending =
    d.payment?.method === 'PIX' && d.payment.status === 'PENDENTE' && d.status === 'CRIADO';
  const live = d.status !== 'ENTREGUE' && d.status !== 'CANCELADO';

  return (
    <Page onRefresh={() => void reload()}>
      {offline ? <OfflineBanner /> : null}
      {!offline && live && realtime !== 'open' ? (
        <WarnBanner text="Atualizando a cada poucos segundos (sem tempo real)." />
      ) : null}
      <Button title="‹ Voltar" kind="ghost" onPress={onBack} />
      <Heading>{statusText(d)}</Heading>
      {d.status === 'CANCELADO' && d.cancelReason ? (
        <Text style={s.muted}>{cancelText(d.kind, d.cancelReason)}</Text>
      ) : null}
      {d.status !== 'CANCELADO' ? <ClientSteps delivery={d} /> : null}
      <ErrorText message={cancelOpen ? null : actionError} />
      {canClientCancel(d.status) ? (
        <Button
          title={`Cancelar ${what}`}
          kind="danger"
          onPress={() => setCancelOpen(true)}
          loading={busy && !cancelOpen}
        />
      ) : null}

      {pixPending && d.payment ? (
        <PixPanel deliveryId={d.id} payment={d.payment} onPaid={() => void reload()} />
      ) : null}

      <DeliveryMap pickup={d.pickup} dropoff={d.dropoff} driver={live ? driverAt : null} />

      {ride && live && d.driver ? <DriverCheckCard d={d} /> : null}

      <Card>
        {d.driver && !ride ? <Row label="Motorista" value={d.driver.name ?? '—'} /> : null}
        <Row label={ride ? 'Saída' : 'Coleta'} value={d.pickup.address} />
        <Row label={ride ? 'Destino' : 'Entrega'} value={d.dropoff.address} />
        {ride && d.womenDriverOnly ? <Row label="Motorista" value="Mulher (pedido)" /> : null}
        {d.notes ? <Row label="Item" value={d.notes} /> : null}
        <Row label="Distância" value={formatDistance(d.distanceMeters)} />
        <Row label="Tempo estimado" value={formatDuration(d.durationSeconds)} />
        <Row label="Total" value={formatBRL(d.fareCents)} strong />
      </Card>

      {d.payment ? <PaymentCard d={d} /> : null}

      {d.status === 'ENTREGUE' ? <RatingCard d={d} onRated={() => void reload()} /> : null}

      {ride && d.driver ? <RideSafetyCard d={d} active={live} /> : null}

      {d.payment && (d.payment.status === 'PAGO' || d.payment.status === 'ESTORNADO') ? (
        <Button title="Ver recibo" kind="ghost" onPress={onReceipt} />
      ) : null}
      <CancelReasonModal
        visible={cancelOpen}
        title="Por que você quer cancelar?"
        message={
          d.payment?.status === 'PAGO'
            ? 'O valor pago será devolvido (estorno).'
            : `${ride ? 'A corrida' : 'O pedido'} será cancelado.`
        }
        options={clientCancelOptions(d.status)}
        confirmLabel="Confirmar cancelamento"
        busy={busy}
        error={actionError}
        onClose={() => setCancelOpen(false)}
        onConfirm={(key) => void confirmCancel(key)}
      />
    </Page>
  );
}

function PaymentCard({ d }: { d: ClientDelivery }) {
  const p = d.payment!;
  return (
    <Card>
      <Text style={s.title}>Pagamento</Text>
      <Row
        label={METHOD_LABEL[p.method]}
        value={PAYMENT_STATUS_LABEL[p.status]}
        color={p.status === 'PAGO' ? colors.ok : undefined}
        testID="payment-status"
      />
      {p.method === 'CARTAO' ? <Text style={s.muted}>{paymentLine(p)}</Text> : null}
      {p.status === 'ESTORNADO' ? (
        <Text style={s.muted}>Valor devolvido: {formatBRL(p.amountCents)}.</Text>
      ) : null}
    </Card>
  );
}

function RatingCard({ d, onRated }: { d: ClientDelivery; onRated: () => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (d.rating)
    return (
      <Card>
        <Text style={s.title}>Sua avaliação</Text>
        <RatingStars value={d.rating.stars} />
        {d.rating.comment ? <Text style={s.muted}>{d.rating.comment}</Text> : null}
      </Card>
    );

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/deliveries/${d.id}/rating`, {
        body: { stars, comment: comment.trim() || undefined },
      });
      onRated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={s.title}>
        {d.kind === 'CORRIDA' ? 'Como foi a viagem?' : 'Como foi a entrega?'}
      </Text>
      <RatingStars value={stars} onChange={setStars} />
      <Field
        label="Comentário (opcional)"
        value={comment}
        onChangeText={setComment}
        maxLength={280}
      />
      <ErrorText message={error} />
      <Button title="Enviar avaliação" onPress={send} loading={busy} disabled={stars === 0} />
    </Card>
  );
}

const s = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 },
  title: { color: colors.black, fontSize: 18, fontWeight: '800' },
});
