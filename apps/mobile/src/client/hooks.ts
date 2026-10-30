import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { errorMessage } from '../errors';
import { useClient } from './ClientProvider';
import { isOpen } from './labels';
import type { ClientDelivery, Coords } from './types';

const POLL_MS = 5000;

/** Um pedido ao vivo: carrega, escuta o tempo real e, se o WebSocket cair, consulta a cada 5 s. */
export function useLiveDelivery(id: string) {
  const { subscribe, realtime } = useClient();
  const [delivery, setDelivery] = useState<ClientDelivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driverAt, setDriverAt] = useState<Coords | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const d = await api<ClientDelivery>(`/deliveries/${id}`);
      if (!alive.current) return;
      setDelivery(d);
      setError(null);
      if (d.driverPosition) setDriverAt({ lat: d.driverPosition.lat, lng: d.driverPosition.lng });
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const off = subscribe((event, data) => {
      const d = data as { id?: string; deliveryId?: string; lat?: number; lng?: number };
      if (event === 'driver.position' && d.deliveryId === id && d.lat != null && d.lng != null)
        setDriverAt({ lat: d.lat, lng: d.lng });
      else if (
        (event === 'delivery.updated' && d.id === id) ||
        (event === 'payment.updated' && d.deliveryId === id)
      )
        void reload();
    });
    return () => {
      alive.current = false;
      off();
    };
  }, [id, reload, subscribe]);

  const open = !delivery || isOpen(delivery.status);
  useEffect(() => {
    if (realtime === 'open' || !open) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [realtime, open, reload]);

  return { delivery, error, reload, driverAt };
}

/** Carrega uma vez (e de novo quando `key` muda). */
export function useRemote<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [key]);
  useEffect(() => {
    void run();
  }, [run]);
  return { data, error, loading, reload: run };
}

/** Relógio que anda de 1 em 1 s (para a contagem do Pix). */
export function useNow(active = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
