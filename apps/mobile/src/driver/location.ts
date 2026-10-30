import { BRAND } from '@amma/shared';
import * as Location from 'expo-location';
import { publishPosition } from './positionBus';
import type { Coords } from './types';

export const LOCATION_TASK = 'amma-driver-location';

/**
 * Nível de permissão de localização:
 * - `background`: "o tempo todo" — recebe pedidos com o app fechado;
 * - `foreground`: só com o app aberto;
 * - `undetermined`: ainda não perguntamos; `denied`: o motorista negou.
 */
export type LocationAccess = 'undetermined' | 'denied' | 'foreground' | 'background';

export async function locationAccess(): Promise<LocationAccess> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return fg.status === 'undetermined' ? 'undetermined' : 'denied';
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.granted ? 'background' : 'foreground';
}

/**
 * Pede as permissões em dois passos (o Android exige assim: primeiro "durante o uso", depois "o
 * tempo todo"). Só deve ser chamada DEPOIS da tela de consentimento.
 */
export async function requestLocationAccess(): Promise<LocationAccess> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  try {
    await Location.requestBackgroundPermissionsAsync();
  } catch {
    /* alguns aparelhos recusam o pedido; seguimos com o que foi concedido */
  }
  return locationAccess();
}

export async function currentPosition(): Promise<Coords> {
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: p.coords.latitude, lng: p.coords.longitude };
}

export interface TrackingOptions {
  /** Permissão "o tempo todo": usa a tarefa do sistema, que sobrevive ao app em segundo plano. */
  background: boolean;
  /** Precisão alta (GPS) só durante uma entrega; parado esperando pedido basta a equilibrada. */
  precise: boolean;
}

const MIN_DISTANCE_METERS = 20;
const MIN_INTERVAL_MS = 5000;

/** Começa a ler a posição; devolve a função que para. As posições saem em `positionBus`. */
export async function startTracking({
  background,
  precise,
}: TrackingOptions): Promise<() => Promise<void>> {
  const accuracy = precise ? Location.Accuracy.High : Location.Accuracy.Balanced;
  if (background) {
    await stopBackgroundTask(); // reinicia com a precisão certa
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy,
      distanceInterval: MIN_DISTANCE_METERS,
      timeInterval: MIN_INTERVAL_MS,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      // Aviso fixo no Android: o sistema exige enquanto lemos a posição em segundo plano.
      foregroundService: {
        notificationTitle: 'AMMA — você está online',
        notificationBody: 'Recebendo pedidos perto de você. Fique offline para parar.',
        notificationColor: BRAND.red,
      },
    });
    return stopBackgroundTask;
  }
  const sub = await Location.watchPositionAsync(
    { accuracy, distanceInterval: MIN_DISTANCE_METERS, timeInterval: MIN_INTERVAL_MS },
    (loc) => publishPosition({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
  );
  return async () => sub.remove();
}

export async function stopBackgroundTask(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false))
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}
