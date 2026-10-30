import { useState } from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';
import { API_URL, api, getAccessToken } from '../../api';
import { errorMessage } from '../../errors';
import { colors } from '../../theme';
import { Button, ErrorText } from '../../ui';
import { Card } from '../../driver/components/layout';
import { EmergencyButton } from '../../driver/components/EmergencyButton';
import { ReportCard } from '../../safety/ReportCard';
import { formatRating } from '../../driver/format';
import type { ClientDelivery, TripShare } from '../types';

/** Para o passageiro conferir quem chegou: nome, nota, foto, placa, modelo e o PIN que confirma o embarque. */
export function DriverCheckCard({ d }: { d: ClientDelivery }) {
  const [photo, setPhoto] = useState(true);
  if (!d.driver) return null;
  const token = getAccessToken();
  return (
    <Card>
      <Text style={s.title}>Confira o motorista</Text>
      <View style={s.who}>
        {photo && token ? (
          <Image
            testID="driver-photo"
            source={{
              uri: `${API_URL}/rides/${d.id}/driver-photo`,
              headers: { authorization: `Bearer ${token}` },
            }}
            onError={() => setPhoto(false)}
            style={s.photo}
            accessibilityLabel={`Foto de ${d.driver.name ?? 'motorista'}`}
          />
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.name}>{d.driver.name ?? '—'}</Text>
          <Text style={s.muted}>{formatRating(d.driverRating)}</Text>
          {d.vehicle ? (
            <>
              <Text style={s.plate} testID="vehicle-plate">
                {d.vehicle.plate}
              </Text>
              <Text style={s.muted}>
                {d.vehicle.model} · {d.vehicle.year}
              </Text>
            </>
          ) : null}
        </View>
      </View>
      {d.boardingPin ? (
        <View style={s.pinBox}>
          <Text style={s.muted}>
            PIN de embarque — diga ao motorista só quando conferir a placa
          </Text>
          <Text style={s.pin} testID="boarding-pin">
            {d.boardingPin}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/** Compartilhar a viagem, emergência e denúncia, durante e depois da corrida. */
export function RideSafetyCard({ d, active }: { d: ClientDelivery; active: boolean }) {
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api<TripShare>(`/rides/${d.id}/shares`, { body: {} });
      // O contato recebe o link pelo compartilhamento do sistema (WhatsApp, SMS...); a AMMA não envia nada.
      await Share.share({
        message: `Estou em uma corrida pela AMMA. Acompanhe minha viagem em tempo real: ${s.url}`,
      });
      setShared(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={s.title}>Segurança</Text>
      {active ? (
        <>
          <Button title="Compartilhar minha viagem" kind="ghost" onPress={share} loading={busy} />
          {shared ? (
            <Text style={s.muted}>
              Link enviado. Quem o abrir vê o motorista, o veículo e onde você está, até pouco
              depois da viagem terminar.
            </Text>
          ) : null}
          <ErrorText message={error} />
          <EmergencyButton deliveryId={d.id} />
        </>
      ) : null}
      {reporting ? (
        <ReportCard deliveryId={d.id} onClose={() => setReporting(false)} />
      ) : (
        <Button title="Denunciar" kind="ghost" onPress={() => setReporting(true)} />
      )}
      <Text style={s.muted}>
        A posição do veículo é registrada durante a corrida e guardada por 90 dias, só para apuração
        de denúncias e emergências.
      </Text>
    </Card>
  );
}

const s = StyleSheet.create({
  title: { color: colors.black, fontSize: 18, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 13 },
  who: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.border },
  name: { color: colors.black, fontSize: 18, fontWeight: '700' },
  plate: { color: colors.black, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  pinBox: {
    backgroundColor: colors.cream,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  pin: { color: colors.red, fontSize: 36, fontWeight: '800', letterSpacing: 8 },
});
