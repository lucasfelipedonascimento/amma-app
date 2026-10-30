import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { isValidCnpj, maskCnpj } from '@amma/shared';
import { api } from '../../api';
import { errorMessage } from '../../errors';
import { colors } from '../../theme';
import { Button, ErrorText, Field } from '../../ui';
import { Card, Heading, Page } from '../../driver/components/layout';
import { OfflineBanner } from '../../driver/components/states';
import { geocode, myPlace } from '../address';
import { useClient } from '../ClientProvider';
import type { MerchantProfile, Place } from '../types';

/** Cadastro do estabelecimento: o endereço vira a coleta padrão dos pedidos. */
export function MerchantScreen() {
  const { merchant, setMerchant, offline } = useClient();
  const [tradeName, setTradeName] = useState(merchant?.tradeName ?? '');
  const [cnpj, setCnpj] = useState(merchant?.cnpj ? maskCnpj(merchant.cnpj) : '');
  const [address, setAddress] = useState(merchant?.address ?? '');
  const [known, setKnown] = useState<Place | null>(
    merchant ? { lat: merchant.lat, lng: merchant.lng, address: merchant.address } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const useMyLocation = async () => {
    setError(null);
    try {
      const p = await myPlace();
      setAddress(p.address);
      setKnown(p);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const save = async () => {
    setError(null);
    setSaved(false);
    if (tradeName.trim().length < 2) return setError('Informe o nome do estabelecimento.');
    if (cnpj && !isValidCnpj(cnpj))
      return setError('CNPJ inválido. Confira os números ou deixe em branco.');
    if (address.trim().length < 5) return setError('Informe o endereço do estabelecimento.');
    setBusy(true);
    try {
      const place = known && known.address === address.trim() ? known : await geocode(address);
      if (!place) return setError('Não encontramos esse endereço. Confira rua, número e bairro.');
      const body = {
        tradeName: tradeName.trim(),
        cnpj: cnpj || undefined,
        address: address.trim(),
        lat: place.lat,
        lng: place.lng,
      };
      setMerchant(await api<MerchantProfile>('/merchant', { method: 'PUT', body }));
      setKnown(place);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      {offline ? <OfflineBanner /> : null}
      <Heading>Meu estabelecimento</Heading>
      <Text style={s.muted}>
        O endereço cadastrado vem preenchido como local de coleta nos seus pedidos.
      </Text>
      <Field
        label="Nome do estabelecimento"
        value={tradeName}
        onChangeText={setTradeName}
        maxLength={80}
      />
      <Field
        label="CNPJ (opcional)"
        value={cnpj}
        onChangeText={(t) => setCnpj(maskCnpj(t))}
        keyboardType="number-pad"
        placeholder="00.000.000/0000-00"
      />
      <Field
        label="Endereço"
        value={address}
        onChangeText={setAddress}
        placeholder="Rua, número, bairro"
        autoComplete="street-address"
      />
      <Button title="Usar minha localização" kind="ghost" onPress={useMyLocation} disabled={busy} />
      <ErrorText message={error} />
      {saved ? (
        <Card>
          <Text style={{ color: colors.ok, fontWeight: '700' }}>Estabelecimento salvo.</Text>
        </Card>
      ) : null}
      <Button title="Salvar" onPress={save} loading={busy} disabled={offline} />
    </Page>
  );
}

const s = StyleSheet.create({ muted: { color: colors.muted, fontSize: 14 } });
