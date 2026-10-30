import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { colors } from '../../theme';
import type { Coords, Place } from '../types';

const EDGE = { top: 50, right: 50, bottom: 50, left: 50 };

/** Mapa do cliente: coleta (verde), entrega (preto) e o motorista (ponto vermelho) em tempo real. */
export function DeliveryMap({
  pickup,
  dropoff,
  driver,
}: {
  pickup: Place;
  dropoff: Place;
  driver?: Coords | null;
}) {
  const ref = useRef<MapView>(null);

  // Enquadra tudo quando os pontos mudam; o motorista anda sem reenquadrar a cada posição.
  useEffect(() => {
    const pts = [pickup, dropoff, ...(driver ? [driver] : [])].map((p) => ({
      latitude: p.lat,
      longitude: p.lng,
    }));
    ref.current?.fitToCoordinates(pts, { edgePadding: EDGE, animated: true });
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, !!driver]);

  return (
    <View style={s.wrap}>
      <MapView
        ref={ref}
        style={s.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{
          latitude: (pickup.lat + dropoff.lat) / 2,
          longitude: (pickup.lng + dropoff.lng) / 2,
          latitudeDelta: Math.max(0.02, Math.abs(pickup.lat - dropoff.lat) * 2),
          longitudeDelta: Math.max(0.02, Math.abs(pickup.lng - dropoff.lng) * 2),
        }}
        toolbarEnabled={false}
        accessibilityLabel="Mapa da entrega"
      >
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
            title="Motorista"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={s.driver} />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { height: 240, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.border },
  map: { flex: 1 },
  driver: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.red,
    borderWidth: 3,
    borderColor: colors.white,
  },
});
