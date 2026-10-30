/** Utilidades geográficas puras (sem dependências). Coordenadas em graus decimais (WGS84). */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const isValidPoint = (p: unknown): p is GeoPoint => {
  if (typeof p !== 'object' || p === null) return false;
  const { lat, lng } = p as Record<string, unknown>;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

const EARTH_RADIUS_METERS = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distância em linha reta (haversine), em metros inteiros. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h))));
}
