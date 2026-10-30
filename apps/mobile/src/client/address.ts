import * as Location from 'expo-location';
import type { Place } from './types';

/** O serviço é de João Pessoa: sem cidade/UF no texto, a busca é feita lá (evita cair em outra "Rua A"). */
export function geocodeQuery(text: string): string {
  const t = text.trim();
  return /jo[aã]o pessoa|\bpb\b|paraíba|paraiba/i.test(t) ? t : `${t}, João Pessoa - PB`;
}

/** Endereço digitado → coordenadas, usando o geocodificador do próprio aparelho. null = não achou. */
export async function geocode(text: string): Promise<Place | null> {
  const found = await Location.geocodeAsync(geocodeQuery(text));
  const first = found[0];
  return first ? { lat: first.latitude, lng: first.longitude, address: text.trim() } : null;
}

type Reverse = Awaited<ReturnType<typeof Location.reverseGeocodeAsync>>[number];

/** "Rua X, 100 - Bairro, Cidade" a partir do que o aparelho devolve. */
export function formatAddress(a: Partial<Reverse>): string {
  const street = [a.street, a.streetNumber].filter(Boolean).join(', ');
  const area = [a.district ?? a.subregion, a.city].filter(Boolean).join(', ');
  return [street, area].filter(Boolean).join(' - ');
}

export class LocationDeniedError extends Error {
  constructor() {
    super(
      'Sem permissão de localização. Digite o endereço ou libere nas configurações do aparelho.',
    );
  }
}

/** Onde o cliente está agora (precisa de permissão "durante o uso"). */
export async function myPlace(): Promise<Place> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new LocationDeniedError();
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const lat = p.coords.latitude;
  const lng = p.coords.longitude;
  const [rev] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }).catch(
    () => [],
  );
  return { lat, lng, address: (rev && formatAddress(rev)) || 'Minha localização' };
}
