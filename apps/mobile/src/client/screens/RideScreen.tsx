import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { formatBRL, type PaymentMethod, type RideVehicleType } from '@amma/shared';
import { api } from '../../api';
import { errorMessage } from '../../errors';
import { colors } from '../../theme';
import { Button, ErrorText, Field } from '../../ui';
import { Card, Heading, Page, Row } from '../../driver/components/layout';
import { OfflineBanner } from '../../driver/components/states';
import { formatDistance, formatDuration } from '../../driver/format';
import { geocode, myPlace } from '../address';
import { EMPTY_CARD, type CardFields } from '../components/CardForm';
import { DeliveryMap } from '../components/DeliveryMap';
import { DeliveryItem } from '../components/DeliveryItem';
import { PaymentSection, buildPayment } from '../components/PaymentSection';
import { useClient } from '../ClientProvider';
import { isOpen } from '../labels';
import type { ClientDelivery, Place, RideOption, RideQuote, RideRules } from '../types';

const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const etaText = (o: RideOption) =>
  o.pickupEtaSeconds !== null
    ? `Motorista chega em ${formatDuration(o.pickupEtaSeconds)}`
    : 'Nenhum motorista por perto agora — vamos procurar assim que você pedir';

/**
 * Pedir uma corrida: 1) origem, destino e preferências → 2) estimativa por tipo de veículo
 * (preço, tempo de viagem e quanto o motorista leva para chegar) e pagamento → confirmar.
 * O preço mostrado é enviado junto: se a tabela mudar no meio do caminho, o servidor recusa antes de cobrar.
 */
export function RideScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const { paymentConfig, offline, reloadDeliveries } = useClient();
  const [rules, setRules] = useState<RideRules | null>(null);
  const [rides, setRides] = useState<ClientDelivery[]>([]);
  const [pickupText, setPickupText] = useState('');
  const [dropoffText, setDropoffText] = useState('');
  const [known, setKnown] = useState<Place | null>(null);
  const [women, setWomen] = useState(false);
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [places, setPlaces] = useState<{ pickup: Place; dropoff: Place } | null>(null);
  const [quote, setQuote] = useState<RideQuote | null>(null);
  const [chosen, setChosen] = useState<RideVehicleType | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [card, setCard] = useState<CardFields>(EMPTY_CARD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());

  useEffect(() => {
    api<RideRules>('/rides/rules')
      .then(setRules)
      .catch((e) => setError(errorMessage(e)));
    api<ClientDelivery[]>('/rides?limit=20')
      .then(setRides)
      .catch(() => undefined);
  }, []);

  const enabled = rules?.vehicleTypes.some((v) => v.enabled) ?? true;
  const open = rides.filter((r) => isOpen(r.status));
  const past = rides.filter((r) => !isOpen(r.status)).slice(0, 5);

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
      return setError('Informe de onde você sai e para onde vai.');
    setBusy(true);
    try {
      const pickup =
        known && known.address === pickupText.trim() ? known : await geocode(pickupText);
      if (!pickup)
        return setError('Não encontramos o endereço de saída. Confira rua, número e bairro.');
      const dropoff = await geocode(dropoffText);
      if (!dropoff) return setError('Não encontramos o destino. Confira rua, número e bairro.');
      const q = await api<RideQuote>('/rides/quote', {
        body: { pickup, dropoff, womenDriverOnly: women },
      });
      setPlaces({ pickup, dropoff });
      setQuote(q);
      setChosen(q.options.find((o) => o.available)?.vehicleType ?? null);
      key.current = newKey(); // outro preço = outra tentativa de pedido
      setStep('review');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const option = quote?.options.find((o) => o.vehicleType === chosen) ?? null;

  const confirm = async () => {
    if (!places || !option || option.fareCents === null) return;
    setError(null);
    setBusy(true);
    try {
      const payment = await buildPayment(method, card, paymentConfig);
      const created = await api<ClientDelivery>('/rides', {
        body: {
          ...places,
          vehicleType: option.vehicleType,
          womenDriverOnly: women,
          payment,
          idempotencyKey: key.current,
          expectedFareCents: option.fareCents,
        },
      });
      setCard(EMPTY_CARD);
      void reloadDeliveries();
      setStep('form');
      onOpen(created.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'review' && places && quote)
    return (
      <Page>
        {offline ? <OfflineBanner /> : null}
        <Heading>Escolha sua corrida</Heading>
        <DeliveryMap pickup={places.pickup} dropoff={places.dropoff} />
        <Card>
          <Row label="Saída" value={places.pickup.address} />
          <Row label="Destino" value={places.dropoff.address} />
          <Row label="Distância" value={formatDistance(quote.distanceMeters)} />
          <Row label="Tempo de viagem" value={formatDuration(quote.durationSeconds)} />
          {quote.womenDriverOnly ? <Row label="Motorista" value="Mulher" /> : null}
        </Card>

        {quote.options.length === 0 ? (
          <Card>
            <Text style={s.muted}>Corridas ainda não estão liberadas em João Pessoa.</Text>
          </Card>
        ) : null}
        {quote.options.map((o) => (
          <Pressable
            key={o.vehicleType}
            disabled={!o.available}
            onPress={() => setChosen(o.vehicleType)}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen === o.vehicleType, disabled: !o.available }}
            testID={`option-${o.vehicleType}`}
            style={[s.option, chosen === o.vehicleType && s.optionOn, !o.available && s.off]}
          >
            <View style={s.optionHead}>
              <Text style={s.optionTitle}>{o.label}</Text>
              <Text style={s.price}>{o.available ? formatBRL(o.fareCents!) : '—'}</Text>
            </View>
            <Text style={s.muted}>
              {o.available ? etaText(o) : 'Indisponível no momento'}
              {o.available && o.minimumApplied ? ' · valor mínimo' : ''}
            </Text>
          </Pressable>
        ))}
        {option?.notices.map((n) => (
          <Text key={n} style={s.notice}>
            ⓘ {n}
          </Text>
        ))}

        {option ? (
          <PaymentSection
            method={method}
            onMethod={setMethod}
            card={card}
            onCard={setCard}
            sandbox={!!paymentConfig?.sandbox}
          />
        ) : null}
        <ErrorText message={error} />
        {option && option.fareCents !== null ? (
          <Button
            title={`Pedir ${option.label.toLowerCase()} · ${formatBRL(option.fareCents)}`}
            onPress={confirm}
            loading={busy}
            disabled={offline}
          />
        ) : null}
        <Button title="Voltar" kind="ghost" onPress={() => setStep('form')} disabled={busy} />
      </Page>
    );

  return (
    <Page>
      {offline ? <OfflineBanner /> : null}
      <Heading>Pedir uma corrida</Heading>
      {open.map((r) => (
        <DeliveryItem key={r.id} d={r} onPress={() => onOpen(r.id)} />
      ))}
      {!enabled ? (
        <Card>
          <Text style={s.muted}>
            Corridas de passageiro ainda não estão liberadas em {rules?.city}.
          </Text>
        </Card>
      ) : (
        <>
          <Field
            label="De onde você sai"
            value={pickupText}
            onChangeText={setPickupText}
            placeholder="Rua, número, bairro"
            autoComplete="street-address"
          />
          <Button
            title="Usar minha localização"
            kind="ghost"
            onPress={useMyLocation}
            disabled={busy}
          />
          <Field
            label="Para onde você vai"
            value={dropoffText}
            onChangeText={setDropoffText}
            placeholder="Rua, número, bairro"
          />
          {rules?.womenDriverOptionEnabled ? (
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.optionTitle}>Prefiro motorista mulher</Text>
                <Text style={s.muted}>
                  Só motoristas mulheres verificadas pela associação recebem o pedido. Pode demorar
                  mais para encontrar.
                </Text>
              </View>
              <Switch
                value={women}
                onValueChange={setWomen}
                accessibilityLabel="Prefiro motorista mulher"
                trackColor={{ true: colors.red }}
              />
            </View>
          ) : null}
          <ErrorText message={error} />
          <Button title="Ver preços e tempo" onPress={seePrice} loading={busy} disabled={offline} />
          <Text style={s.muted}>
            Por segurança, a viagem é registrada e você pode compartilhá-la com quem quiser.
          </Text>
        </>
      )}
      {past.length > 0 ? <Text style={s.section}>Corridas recentes</Text> : null}
      {past.map((r) => (
        <DeliveryItem key={r.id} d={r} onPress={() => onOpen(r.id)} />
      ))}
    </Page>
  );
}

const s = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 },
  notice: { color: colors.warn, fontSize: 13 },
  section: { color: colors.black, fontWeight: '800', fontSize: 16, marginTop: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  option: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 2,
  },
  optionOn: { borderColor: colors.red },
  off: { opacity: 0.5 },
  optionHead: { flexDirection: 'row', justifyContent: 'space-between' },
  optionTitle: { color: colors.black, fontWeight: '700', fontSize: 17 },
  price: { color: colors.black, fontWeight: '800', fontSize: 17 },
});
