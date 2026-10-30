import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  AMENITIES,
  HOST_BENEFIT_KINDS,
  HOUSE_CHECKLIST,
  POINT_TYPES,
  missingChecklistItems,
  type Amenity,
  type HostBenefitKind,
  type PointType,
} from '@amma/shared';
import { api } from '../api';
import { geocode } from '../client/address';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText, Field } from '../ui';
import { Chips, muted, strong } from '../association/parts';
import { Card } from '../driver/components/layout';
import { AMENITY_LABEL, HOURS_PRESETS, TYPE_LABEL } from './labels';
import { MultiChips } from './parts';
import { whereAmI } from './position';
import type { Position, WelcomePointView } from './types';

const BENEFIT_LABEL: Record<HostBenefitKind, string> = {
  CREDITO: 'Crédito no saldo',
  DESCONTO: 'Desconto nas taxas',
};

/** Cadastro de um ponto. A casa parceira leva o checklist de segurança e espera a aprovação da associação. */
export function RegisterTab({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<PointType | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [reference, setReference] = useState('');
  const [where, setWhere] = useState<Position | null>(null);
  const [hours, setHours] = useState('24h');
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [capacity, setCapacity] = useState('2');
  const [benefit, setBenefit] = useState<HostBenefitKind>('CREDITO');
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<WelcomePointView | null>(null);

  const isHouse = type === 'CASA_PARCEIRA';

  const locate = async (fn: () => Promise<Position | null>, notFound: string) => {
    setError(null);
    try {
      const p = await fn();
      if (p) setWhere(p);
      else setError(notFound);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const submit = async () => {
    if (!type) return setError('Escolha o tipo de ponto.');
    if (name.trim().length < 3) return setError('Dê um nome ao ponto (ao menos 3 letras).');
    if (address.trim().length < 5 || neighborhood.trim().length < 2)
      return setError('Informe o endereço e o bairro.');
    if (!where) return setError('Marque a posição: use a sua localização ou busque pelo endereço.');
    if (amenities.length === 0) return setError('Marque ao menos uma comodidade.');
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 50)
      return setError('A capacidade deve ser de 1 a 50 pessoas.');
    const checklist = Object.fromEntries(checked.map((k) => [k, true]));
    if (isHouse && missingChecklistItems(checklist).length > 0)
      return setError('Confirme todos os itens do checklist de segurança.');
    setBusy(true);
    setError(null);
    try {
      const created = await api<WelcomePointView>('/welcome-points', {
        method: 'POST',
        body: {
          type,
          name: name.trim(),
          address: address.trim(),
          neighborhood: neighborhood.trim(),
          reference: reference.trim() || undefined,
          lat: where.lat,
          lng: where.lng,
          hours: HOURS_PRESETS.find((h) => h.key === hours)!.hours,
          amenities,
          capacity: cap,
          ...(isHouse ? { benefitKind: benefit, checklist } : {}),
        },
      });
      setSent(created);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <Card>
        <Text style={strong}>
          {sent.status === 'EM_ANALISE' ? 'Enviado para análise' : 'Ponto publicado'}
        </Text>
        <Text style={muted}>
          {sent.status === 'EM_ANALISE'
            ? 'A associação vai conferir o local e o anfitrião antes de colocar a casa no mapa. Você acompanha em “Meus pontos”, onde também pode enviar fotos.'
            : 'Seu ponto já aparece no mapa. Em “Meus pontos” você pode enviar fotos.'}
        </Text>
        <Button title="Ver meus pontos" onPress={onDone} />
      </Card>
    );

  return (
    <>
      <Card>
        <Text style={strong}>Tipo de ponto</Text>
        <Chips
          items={POINT_TYPES.map((t) => ({ key: t, label: TYPE_LABEL[t] }))}
          current={type}
          onChange={setType}
        />
        {type === 'CASA_PARCEIRA' ? (
          <Text style={muted}>
            Casa parceira passa por checklist de segurança e aprovação da associação. No mapa, só
            aparecem o bairro e uma posição aproximada.
          </Text>
        ) : null}
      </Card>
      <Card>
        <Field label="Nome do ponto" value={name} onChangeText={setName} maxLength={80} />
        <Field label="Endereço" value={address} onChangeText={setAddress} maxLength={200} />
        <Field label="Bairro" value={neighborhood} onChangeText={setNeighborhood} maxLength={80} />
        <Field
          label="Ponto de referência (opcional)"
          value={reference}
          onChangeText={setReference}
          maxLength={200}
        />
        <Button
          title="Usar a minha localização agora"
          kind="ghost"
          onPress={() => void locate(whereAmI, 'Não foi possível pegar a localização.')}
        />
        <Button
          title="Buscar pelo endereço"
          kind="ghost"
          onPress={() =>
            void locate(async () => {
              const g = await geocode(address);
              return g ? { lat: g.lat, lng: g.lng } : null;
            }, 'Não encontramos esse endereço. Tente a sua localização.')
          }
        />
        <Text style={where ? { color: colors.ok, fontWeight: '700' } : muted}>
          {where ? 'Posição marcada.' : 'Posição ainda não marcada.'}
        </Text>
      </Card>
      <Card>
        <Text style={strong}>Horário</Text>
        <Chips
          items={HOURS_PRESETS.map((h) => ({ key: h.key, label: h.label }))}
          current={hours}
          onChange={setHours}
        />
        <Text style={strong}>Comodidades</Text>
        <MultiChips
          items={AMENITIES.map((a) => ({ key: a, label: AMENITY_LABEL[a] }))}
          selected={amenities}
          onChange={setAmenities}
        />
        <Field
          label="Quantas pessoas cabem ao mesmo tempo"
          value={capacity}
          onChangeText={setCapacity}
          keyboardType="number-pad"
          maxLength={2}
        />
      </Card>
      {isHouse ? (
        <>
          <Card>
            <Text style={strong}>Checklist de segurança</Text>
            {HOUSE_CHECKLIST.map((i) => {
              const on = checked.includes(i.key);
              return (
                <Pressable
                  key={i.key}
                  onPress={() =>
                    setChecked(on ? checked.filter((k) => k !== i.key) : [...checked, i.key])
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={i.text}
                >
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 20, color: on ? colors.ok : colors.muted }}>
                      {on ? '☑' : '☐'}
                    </Text>
                    <Text style={{ flex: 1, color: colors.black }}>{i.text}</Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
          <Card>
            <Text style={strong}>Como você quer ser recompensado</Text>
            <Chips
              items={HOST_BENEFIT_KINDS.map((k) => ({ key: k, label: BENEFIT_LABEL[k] }))}
              current={benefit}
              onChange={setBenefit}
            />
            <Text style={muted}>
              Cada visita de 5 minutos ou mais rende R$ 1,00, até R$ 30,00 por mês. Os valores são
              exemplos e a associação pode mudar.
            </Text>
          </Card>
        </>
      ) : null}
      <ErrorText message={error} />
      <Button
        title={isHouse ? 'Enviar para análise' : 'Cadastrar ponto'}
        onPress={() => void submit()}
        loading={busy}
      />
    </>
  );
}
