import { useEffect, useRef, useState } from 'react';
import { haversineMeters } from '@amma/shared';
import { api } from '../api';
import { errorMessage } from '../errors';
import type { ActiveDelivery, Coords, RouteInfo } from './types';

/** Só pede rota nova se andou pelo menos isto E já passou o tempo mínimo (custo do provedor de rotas). */
export const REROUTE_METERS = 200;
export const REROUTE_MIN_MS = 15_000;

/**
 * Rota da posição atual até o próximo ponto. Busca de novo quando a etapa muda ou quando o
 * motorista se afasta bastante do ponto da última consulta (saiu da rota).
 */
export function useRouteInfo(active: ActiveDelivery | null, position: Coords | null) {
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ id: string; status: string; from: Coords; at: number } | null>(null);
  const request = useRef(0);

  const id = active?.id;
  const status = active?.status;

  useEffect(() => {
    if (!id || !status) {
      last.current = null;
      setRoute(null);
      setError(null);
      return;
    }
    if (!position) return;
    const l = last.current;
    const changed = !l || l.id !== id || l.status !== status;
    const wandered =
      !!l &&
      haversineMeters(l.from, position) > REROUTE_METERS &&
      Date.now() - l.at > REROUTE_MIN_MS;
    if (!changed && !wandered) return;

    last.current = { id, status, from: position, at: Date.now() };
    const mine = ++request.current;
    api<RouteInfo>(`/driver/deliveries/${id}/route?lat=${position.lat}&lng=${position.lng}`)
      .then((r) => {
        if (mine !== request.current) return;
        setRoute(r);
        setError(null);
      })
      .catch((e) => {
        if (mine !== request.current) return;
        // Deixa tentar de novo na próxima posição em vez de ficar sem rota para sempre.
        last.current = null;
        setError(errorMessage(e));
      });
  }, [id, status, position]);

  return { route, error };
}
