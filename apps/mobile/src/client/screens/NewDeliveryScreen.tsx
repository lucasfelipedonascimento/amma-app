import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { formatBRL, type PaymentMethod } from '@amma/shared';
import { api } from '../../api';
import { errorMessage } from '../../errors';
import { colors } from '../../theme';
import { Button, ErrorText, Field } from '../../ui';
import { Card, Heading, Page, Row } from '../../driver/components/layout';
import { OfflineBanner } from '../../driver/components/states';
import { formatDistance, formatDuration } from '../../driver/format';
import { geocode, myPlace } from '../address';
import { EMPTY_CARD, type CardFields } from '../components/CardForm';
import { PaymentSection, buildPayment } from '../components/PaymentSection';
import { DeliveryMap } from '../components/DeliveryMap';
import { useClient } from '../ClientProvider';
import type { ClientDelivery, Place, Quote } from '../types';

const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

interface Resolved {
  pickup: Place;
  dropoff: Place;
  notes: string;
}

/**
 * Pedir uma entrega: 1) origem, destino e descrição → 2) preço, mapa e forma de pagamento → confirmar.
 * O preço mostrado é enviado junto: se a tabela mudar no meio do caminho, o servidor recusa antes de cobrar.
 */
export function NewDeliveryScreen({
  onCreated,
  onOpenStore,
}: {
  onCreated: (id: string) => void;
  onOpenStore: () => void;
}) {
  const { merchant, isMerchant, paymentConfig, offline, reloadDeliveries } = useClient();
  const [pickupText, setPickupText] = useState(merchant?.address ?? '');
  const [dropoffText, setDropoffText] = useState('');
  const [notes, setNotes] = useState('');
  // Locais já com coordenadas (GPS ou estabelecimento): só valem enquanto o texto não for editado.
  const [known, setKnown] = useState<Place | null>(
    merchant ? { lat: merchant.lat, lng: merchant.lng, address: merchant.address } : null,
  );
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [card, setCard] = useState<CardFields>(EMPTY_CARD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());

  // O estabelecimento pode terminar de carregar depois da tela abrir: preenche a coleta, se ainda vazia.
  useEffect(() => {
    if (merchant && !pickupText && !known) {
      setPickupText(merchant.address);
      setKnown({ lat: merchant.lat, lng: merchant.lng, address: merchant.address });
    }
  }, [merchant, pickupText, known]);

  const useMyLocation = async () => {
    setError(null);
    try {
      const p = await myPlace();
      setPickupText(p.address);
      setKnown(p);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const seePrice = async () => {
    setError(null);
    if (pickupText.trim().length < 3 || dropoffText.trim().length < 3)
      return setError('Informe o endereço de coleta e o de entrega.');
    if (notes.trim().length < 3) return setError('Descreva o que vai ser entregue.');
    setBusy(true);
    try {
      const pickup =
        known && known.address === pickupText.trim() ? known : await geocode(pickupText);
      if (!pickup)
        return setError('Não encontramos o endereço de coleta. Confira rua, número e bairro.');
      const dropoff = await geocode(dropoffText);
      if (!dropoff)
        return setError('Não encontramos o endereço de entrega. Confira rua, número e bairro.');
      const q = await api<Quote>('/deliveries/quote', {
        body: { pickup, dropoff, notes: notes.trim() },
      });
      setResolved({ pickup, dropoff, notes: notes.trim() });
      setQuote(q);
      key.current = newKey(); // outro preço = outra tentativa de pedido
      setStep('review');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!resolved || !quote) return;
    setError(null);
    setBusy(true);
    try {
      const payment = await buildPayment(method, card, paymentConfig);
      const created = await api<ClientDelivery>('/deliveries', {
        body: {
          ...resolved,
          payment,
          idempotencyKey: key.current,
          expectedFareCents: quote.fareCents,
        },
      });
      setCard(EMPTY_CARD);
      void reloadDeliveries();
      onCreated(created.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'review' && resolved && quote)
    return (
      <Page>
        {offline ? <OfflineBanner /> : null}
        <Heading>Confirme seu pedido</Heading>
        <DeliveryMap pickup={resolved.pickup} dropoff={resolved.dropoff} />
        <Card>
          <Row label="Coleta" value={resolved.pickup.address} />
          <Row label="Entrega" value={resolved.dropoff.address} />
          <Row label="Item" value={resolved.notes} />
          <Row label="Distância" value={formatDistance(quote.distanceMeters)} />
          <Row label="Tempo estimado" value={formatDuration(quote.durationSeconds)} />
          <Row label="Total" value={formatBRL(quote.fareCents)} strong testID="quote-total" />
          {quote.minimumApplied ? (
            <Text style={s.muted}>Valor mínimo da entrega aplicado.</Text>
          ) : null}
        </Card>

        <PaymentSection
          method={method}
          onMethod={setMethod}
          card={card}
          onCard={setCard}
          sandbox={!!paymentConfig?.sandbox}
        />
        <ErrorText message={error} />
        <Button
          title={`Confirmar e pagar ${formatBRL(quote.fareCents)}`}
          onPress={confirm}
          loading={busy}
          disabled={offline}
        />
        <Button title="Voltar" kind="ghost" onPress={() => setStep('form')} disabled={busy} />
      </Page>
    );

  return (
    <Page>
      {offline ? <OfflineBanner /> : null}
      <Heading>Pedir uma entrega</Heading>
      {isMerchant && merchant === null ? (
        <Card>
          <Text style={s.muted}>
            Cadastre seu estabelecimento para a coleta vir preenchida com o seu endereço.
          </Text>
          <Button title="Cadastrar estabelecimento" kind="ghost" onPress={onOpenStore} />
        </Card>
      ) : null}
      <Field
        label="Onde coletar"
        value={pickupText}
        onChangeText={setPickupText}
        placeholder="Rua, número, bairro"
        autoComplete="street-address"
      />
      <Button title="Usar minha localização" kind="ghost" onPress={useMyLocation} disabled={busy} />
      <Field
        label="Para onde entregar"
        value={dropoffText}
        onChangeText={setDropoffText}
        placeholder="Rua, número, bairro"
      />
      <Field
        label="O que vai ser entregue?"
        value={notes}
        onChangeText={setNotes}
        placeholder="Ex.: marmita, 1 caixa pequena"
        maxLength={280}
      />
      <ErrorText message={error} />
      <Button title="Ver preço" onPress={seePrice} loading={busy} disabled={offline} />
      <Text style={s.muted}>Você só paga depois de ver o preço e confirmar.</Text>
    </Page>
  );
}

const s = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 },
});
