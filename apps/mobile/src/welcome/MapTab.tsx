import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { AMENITIES, POINT_TYPES, type Amenity, type PointType } from '@amma/shared';
import { colors } from '../theme';
import { Chips, Loaded, Tag, muted, strong } from '../association/parts';
import { useLoad } from '../association/useLoad';
import { Card } from '../driver/components/layout';
import { LoadingView } from '../driver/components/states';
import { formatRating } from '../driver/format';
import { AMENITY_LABEL, TYPE_LABEL, formatKm } from './labels';
import { MultiChips } from './parts';
import { PointDetail } from './PointDetail';
import { JOAO_PESSOA, whereAmI } from './position';
import type { Position, WelcomePointView } from './types';

const RADIUS = [
  { key: 1000, label: '1 km' },
  { key: 3000, label: '3 km' },
  { key: 5000, label: '5 km' },
  { key: 10000, label: '10 km' },
];
const MIN_RATING = [
  { key: 0, label: 'Qualquer nota' },
  { key: 3, label: '3+' },
  { key: 4, label: '4+' },
];

/** Mapa dos pontos de acolhida perto de você, com filtros por tipo, comodidade, distância, horário e nota. */
export function MapTab({ onCheckedIn }: { onCheckedIn: () => void }) {
  const [pos, setPos] = useState<Position | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    whereAmI()
      .then((p) => alive && setPos(p))
      .catch((e: Error) => {
        if (!alive) return;
        setNotice(`${e.message} Mostrando perto do centro de João Pessoa.`);
        setPos(JOAO_PESSOA);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!pos) return <LoadingView label="Buscando a sua localização…" />;
  return <Results pos={pos} notice={notice} onCheckedIn={onCheckedIn} />;
}

function Results({
  pos,
  notice,
  onCheckedIn,
}: {
  pos: Position;
  notice: string | null;
  onCheckedIn: () => void;
}) {
  const [types, setTypes] = useState<PointType[]>([]);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [openNow, setOpenNow] = useState(false);
  const [radius, setRadius] = useState(5000);
  const [minRating, setMinRating] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const q = [
    `lat=${pos.lat}`,
    `lng=${pos.lng}`,
    `radiusMeters=${radius}`,
    types.length ? `types=${types.join(',')}` : '',
    amenities.length ? `amenities=${amenities.join(',')}` : '',
    openNow ? 'openNow=true' : '',
    minRating ? `minRating=${minRating}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const list = useLoad<WelcomePointView[]>(`/welcome-points?${q}`);

  if (openId)
    return (
      <PointDetail
        id={openId}
        pos={pos}
        onBack={() => {
          setOpenId(null);
          void list.reload();
        }}
        onCheckedIn={onCheckedIn}
      />
    );

  return (
    <>
      {notice ? <Text style={muted}>{notice}</Text> : null}
      <Card>
        <Text style={s.label}>Tipo</Text>
        <MultiChips
          items={POINT_TYPES.map((t) => ({ key: t, label: TYPE_LABEL[t] }))}
          selected={types}
          onChange={setTypes}
        />
        <Text style={s.label}>Comodidades</Text>
        <MultiChips
          items={AMENITIES.map((a) => ({ key: a, label: AMENITY_LABEL[a] }))}
          selected={amenities}
          onChange={setAmenities}
        />
        <Text style={s.label}>Distância</Text>
        <Chips items={RADIUS} current={radius} onChange={setRadius} />
        <Text style={s.label}>Nota</Text>
        <Chips items={MIN_RATING} current={minRating} onChange={setMinRating} />
        <MultiChips
          items={[{ key: 'aberto', label: 'Aberto agora' }]}
          selected={openNow ? ['aberto'] : []}
          onChange={(v) => setOpenNow(v.includes('aberto'))}
        />
      </Card>
      <Loaded data={list.data} error={list.error} onRetry={() => void list.reload()}>
        {(points) => (
          <>
            <View style={s.mapBox}>
              <MapView
                style={s.map}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                initialRegion={{
                  latitude: pos.lat,
                  longitude: pos.lng,
                  latitudeDelta: (radius / 111_000) * 2.2,
                  longitudeDelta: (radius / 111_000) * 2.2,
                }}
                showsUserLocation
                toolbarEnabled={false}
                accessibilityLabel="Mapa dos pontos de acolhida"
              >
                {points.map((p) => (
                  <Marker
                    key={p.id}
                    coordinate={{ latitude: p.lat, longitude: p.lng }}
                    title={p.name}
                    description={TYPE_LABEL[p.type]}
                    pinColor={p.openNow ? colors.ok : colors.muted}
                    onCalloutPress={() => setOpenId(p.id)}
                  />
                ))}
              </MapView>
            </View>
            {points.length === 0 ? (
              <Text style={muted}>
                Nenhum ponto com esses filtros. Aumente a distância ou tire algum filtro.
              </Text>
            ) : (
              points.map((p) => (
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
                      {p.distanceMeters !== undefined ? ` · ${formatKm(p.distanceMeters)}` : ''}
                    </Text>
                    <Text style={muted}>
                      {p.amenities.map((a) => AMENITY_LABEL[a]).join(' · ')}
                    </Text>
                    <Text style={muted}>{formatRating(p.rating)}</Text>
                    <View style={s.tags}>
                      <Tag
                        text={p.openNow ? 'Aberto agora' : 'Fechado agora'}
                        color={p.openNow ? colors.ok : colors.muted}
                      />
                      {p.occupied >= p.capacity ? <Tag text="Lotado" color={colors.red} /> : null}
                    </View>
                  </Card>
                </Pressable>
              ))
            )}
          </>
        )}
      </Loaded>
    </>
  );
}

const s = StyleSheet.create({
  label: { color: colors.black, fontWeight: '700' },
  mapBox: { height: 240, borderRadius: 14, overflow: 'hidden' },
  map: { flex: 1 },
  tags: { flexDirection: 'row', gap: 8 },
});
