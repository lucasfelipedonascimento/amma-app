import * as Location from 'expo-location';
import type { Position } from './types';

/** Centro de João Pessoa: usado quando o aparelho não informa a posição. */
export const JOAO_PESSOA: Position = { lat: -7.115, lng: -34.861 };

export class NoPositionError extends Error {
  constructor() {
    super('Não conseguimos pegar a sua localização. Libere a permissão de localização do app.');
  }
}

/** Onde a pessoa está agora (pede a permissão "durante o uso" se ainda não houver). */
export async function whereAmI(): Promise<Position> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new NoPositionError();
  try {
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    throw new NoPositionError();
  }
}
