import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { WS_URL, api, getAccessToken } from '../api';
import { errorMessage } from '../errors';
import { useIsOffline } from '../network';
import { useSession } from '../session';
import { RealtimeClient, RealtimeStatus } from '../driver/realtime';
import type { ClientDelivery, MerchantProfile, PaymentConfig } from './types';
import { isOpen } from './labels';

export type ClientEventListener = (event: string, data: unknown) => void;

export interface ClientValue {
  isMerchant: boolean;
  realtime: RealtimeStatus;
  offline: boolean;
  /** Recebe os eventos do WebSocket (delivery.updated, payment.updated, driver.position). */
  subscribe: (fn: ClientEventListener) => () => void;
  deliveries: ClientDelivery[] | null;
  deliveriesError: string | null;
  reloadDeliveries: () => Promise<void>;
  /** undefined = ainda carregando; null = comerciante sem estabelecimento cadastrado. */
  merchant: MerchantProfile | null | undefined;
  setMerchant: (m: MerchantProfile) => void;
  paymentConfig: PaymentConfig | null;
}

export const ClientContext = createContext<ClientValue | null>(null);
export const useClient = () => {
  const v = useContext(ClientContext);
  if (!v) throw new Error('useClient fora do ClientProvider');
  return v;
};

const POLL_MS = 5000;

/** Estado do cliente/comerciante: pedidos, estabelecimento, forma de pagamento e tempo real. */
export function ClientProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const isMerchant = !!me?.roles.includes('COMERCIANTE');
  const offline = useIsOffline();
  const [realtime, setRealtime] = useState<RealtimeStatus>('closed');
  const [deliveries, setDeliveries] = useState<ClientDelivery[] | null>(null);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
  const [merchant, setMerchant] = useState<MerchantProfile | null | undefined>(
    isMerchant ? undefined : null,
  );
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const listeners = useRef(new Set<ClientEventListener>());

  const reloadDeliveries = useCallback(async () => {
    try {
      setDeliveries(await api<ClientDelivery[]>('/deliveries?limit=50'));
      setDeliveriesError(null);
    } catch (e) {
      setDeliveriesError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void reloadDeliveries();
    api<PaymentConfig>('/payments/config')
      .then(setPaymentConfig)
      .catch(() => setPaymentConfig(null));
    if (isMerchant)
      api<MerchantProfile | null>('/merchant')
        .then(setMerchant)
        .catch(() => setMerchant(null));
  }, [isMerchant, reloadDeliveries]);

  useEffect(() => {
    const c = new RealtimeClient({
      url: WS_URL,
      getToken: getAccessToken,
      refreshSession: () => api('/me').then(() => undefined),
      onStatus: setRealtime,
      onEvent: (event, data) => {
        listeners.current.forEach((fn) => fn(event, data));
        if (event === 'delivery.updated' || event === 'payment.updated') void reloadDeliveries();
      },
    });
    c.start();
    return () => c.stop();
  }, [reloadDeliveries]);

  // Sem WebSocket e com pedido aberto: consulta a cada 5 s.
  const hasOpen = !!deliveries?.some((d) => isOpen(d.status));
  useEffect(() => {
    if (realtime === 'open' || !hasOpen) return;
    const t = setInterval(() => void reloadDeliveries(), POLL_MS);
    return () => clearInterval(t);
  }, [realtime, hasOpen, reloadDeliveries]);

  // Voltou para o app: atualiza.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void reloadDeliveries();
    });
    return () => sub.remove();
  }, [reloadDeliveries]);

  const value = useMemo<ClientValue>(
    () => ({
      isMerchant,
      realtime,
      offline,
      subscribe: (fn) => {
        listeners.current.add(fn);
        return () => void listeners.current.delete(fn);
      },
      deliveries,
      deliveriesError,
      reloadDeliveries,
      merchant,
      setMerchant,
      paymentConfig,
    }),
    [
      isMerchant,
      realtime,
      offline,
      deliveries,
      deliveriesError,
      reloadDeliveries,
      merchant,
      paymentConfig,
    ],
  );
  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}
