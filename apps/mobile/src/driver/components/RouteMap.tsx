import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import { colors } from '../../theme';
import { Button } from '../../ui';
import type { Coords, Place } from '../types';

const EDGE = { top: 60, right: 50, bottom: 60, left: 50 };
const NO_INSET = { top: 0, bottom: 0 };

/**
 * Mapa da entrega: motorista (ponto vermelho), coleta (verde), entrega (preto) e a rota.
 * Segue o motorista enquanto ele não mexer no mapa; "Centralizar" volta a seguir.
 */
export function RouteMap({
  driver,
  pickup,
  dropoff,
  target,
  path,
  fill,
  inset,
}: {
  driver: Coords | null;
  pickup: Place;
  dropoff: Place;
  target: 'COLETA' | 'ENTREGA';
  path: Coords[] | null;
  /** Ocupa a tela toda em vez de uma caixa de 280 px. */
  fill?: boolean;
  /** Espaço (px) coberto por painéis sobre o mapa, para o enquadramento não ficar escondido. */
  inset?: { top: number; bottom: number };
}) {
  const ref = useRef<MapView>(null);
  const [follow, setFollow] = useState(true);
  const destination = target === 'COLETA' ? pickup : dropoff;

  // Mostra tudo (motorista, destino e rota) quando a rota muda.
  useEffect(() => {
    const points = [destination, ...(driver ? [driver] : []), ...(path ?? [])].map((p) => ({
      latitude: p.lat,
      longitude: p.lng,
    }));
    const pad = inset ?? NO_INSET;
    ref.current?.fitToCoordinates(points, {
      edgePadding: { ...EDGE, top: EDGE.top + pad.top, bottom: EDGE.bottom + pad.bottom },
      animated: true,
    });
    // Só refaz o enquadramento quando o destino ou a rota mudam, não a cada posição.
  }, [destination.lat, destination.lng, path]);

  // Segue o motorista.
  useEffect(() => {
    if (follow && driver)
      ref.current?.animateCamera(
        { center: { latitude: driver.lat, longitude: driver.lng } },
        { duration: 500 },
      );
  }, [follow, driver]);

  return (
    <View style={fill ? s.fill : s.wrap}>
      <MapView
        ref={ref}
        style={s.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{
          latitude: destination.lat,
          longitude: destination.lng,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        }}
        onPanDrag={() => setFollow(false)}
        toolbarEnabled={false}
        accessibilityLabel="Mapa da entrega"
      >
        {path && path.length > 1 ? (
          <Polyline
            coordinates={path.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={colors.red}
            strokeWidth={5}
          />
        ) : null}
        <Marker
          coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
          title="Coleta"
          pinColor="green"
        />
        <Marker
          coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
          title="Entrega"
          pinColor="black"
        />
        {driver ? (
          <Marker
            coordinate={{ latitude: driver.lat, longitude: driver.lng }}
            title="Você"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={s.me} />
          </Marker>
        ) : null}
      </MapView>
      {!follow && driver ? (
        <View style={s.recenter}>
          <Button title="Centralizar" onPress={() => setFollow(true)} />
        </View>
      ) : null}
      {!driver ? (
        <View style={s.wait}>
          <Text style={s.waitText}>Buscando sua localização…</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.border },
  wrap: { height: 280, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.border },
  map: { flex: 1 },
  me: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.red,
    borderWidth: 3,
    borderColor: colors.white,
  },
  recenter: { position: 'absolute', right: 12, bottom: 8, width: 140 },
  wait: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    backgroundColor: colors.black,
    borderRadius: 8,
    padding: 6,
  },
  waitText: { color: colors.white, fontSize: 12 },
});
