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
import { AppState, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { LOCATION_CONSENT_VERSION } from '@amma/shared';
import { WS_URL, api, getAccessToken } from '../api';
import { errorMessage } from '../errors';
import { useIsOffline } from '../network';
import {
  LocationAccess,
  currentPosition,
  locationAccess,
  requestLocationAccess,
  startTracking,
} from './location';
import { subscribePositions } from './positionBus';
import { registerForPush, unregisterPush } from './push';
import { RealtimeClient, RealtimeStatus } from './realtime';
import { nextStep } from './steps';
import type { ActiveDelivery, Coords, Earnings, LocationConsent, Offer, Presence } from './types';

/** Entrega recém-concluída, para a tela mostrar o resultado. */
export interface Completed {
  fareCents: number;
  workerNetCents: number;
  /** Corrida de passageiro: permite avaliar o passageiro depois de concluída. */
  rideId?: string;
}

export interface DriverValue {
  ready: boolean;
  loadError: string | null;
  reload: () => Promise<void>;

  online: boolean;
  /** Uma ação (ficar online, aceitar...) está em andamento. */
  busy: boolean;
  actionError: string | null;
  clearError: () => void;

  position: Coords | null;
  offer: Offer | null;
  active: ActiveDelivery | null;
  completed: Completed | null;
  dismissCompleted: () => void;

  earnings: Earnings | null;
  earningsError: string | null;
  refreshEarnings: () => Promise<void>;

  realtime: RealtimeStatus;
  offline: boolean;
  access: LocationAccess | null;
  consented: boolean | null;
  consentOpen: boolean;
  closeConsent: () => void;
  openSettings: () => void;
  pushNote: string | null;

  goOnline: () => Promise<void>;
  goOffline: () => Promise<void>;
  acceptConsent: () => Promise<void>;
  revokeConsent: () => Promise<void>;
  accept: () => Promise<void>;
  decline: (reason?: string) => Promise<void>;
  /** `pin` é o PIN de embarque (só corrida, ao confirmar o embarque). */
  advance: (pin?: string) => Promise<void>;
  release: () => Promise<void>;
  /** Escuta eventos do tempo real (ex.: `chat.message`). Devolve a função que cancela. */
  subscribe: (fn: (event: string, data: unknown) => void) => () => void;
  /**
   * Cancelar pelo menu de motivos. RELEASE devolve o pedido à fila; CANCEL cancela (coleta ou entrega impossível).
   * Devolve true se deu certo (a tela fecha o menu).
   */
  cancelTrip: (category: string, effect: 'RELEASE' | 'CANCEL') => Promise<boolean>;
  prepareSignOut: () => Promise<void>;
}

const Ctx = createContext<DriverValue | null>(null);
export const DriverContext = Ctx;

export function useDriver(): DriverValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDriver fora do DriverProvider');
  return v;
}

const POLL_MS = 5000;
const REST_POSITION_EVERY_MS = 5000;

/**
 * Estado do motorista no app: presença, posição, oferta, entrega e ganhos.
 * O tempo real vem pelo WebSocket; quando ele cai, uma consulta a cada 5 s mantém a tela certa
 * (o REST sempre devolve o estado atual — nenhum evento perdido perde dado).
 */
export function DriverProvider({ children }: { children: ReactNode }) {
  const offline = useIsOffline();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [position, setPosition] = useState<Coords | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [active, setActive] = useState<ActiveDelivery | null>(null);
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeStatus>('closed');
  const [access, setAccess] = useState<LocationAccess | null>(null);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pushNote, setPushNote] = useState<string | null>(null);

  const client = useRef<RealtimeClient | null>(null);
  const pushToken = useRef<string | null>(null);
  const lastRest = useRef(0);
  const onlineRef = useRef(false);
  onlineRef.current = online;

  // ------------------------------------------------------------------ carregamento

  const refreshEarnings = useCallback(async () => {
    try {
      setEarnings(await api<Earnings>('/driver/earnings'));
      setEarningsError(null);
    } catch (e) {
      setEarningsError(errorMessage(e));
    }
  }, []);

  /** Oferta e entrega em andamento: o que muda com o tempo real. */
  const refreshLive = useCallback(async () => {
    try {
      const [o, a] = await Promise.all([
        api<Offer | null>('/driver/offers/current'),
        api<ActiveDelivery | null>('/driver/deliveries/active'),
      ]);
      setOffer(o);
      setActive(a);
    } catch {
      /* sem rede agora; a próxima rodada tenta de novo */
    }
  }, []);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const [presence, consent, acc] = await Promise.all([
        api<Presence>('/driver/presence'),
        api<LocationConsent>('/driver/location-consent'),
        locationAccess(),
      ]);
      setOnline(presence.online);
      setPosition(presence.position);
      setConsented(consent.granted);
      setAccess(acc);
      await refreshLive();
      setReady(true);
      void refreshEarnings();
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [refreshEarnings, refreshLive]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ------------------------------------------------------------------ tempo real

  const listeners = useRef(new Set<(event: string, data: unknown) => void>());
  const subscribe = useCallback((fn: (event: string, data: unknown) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const handleEvent = useCallback(
    (event: string, data: unknown) => {
      listeners.current.forEach((fn) => fn(event, data));
      if (event === 'offer.created') setOffer(data as Offer);
      else if (event === 'offer.closed') {
        const { offerId } = data as { offerId: string };
        setOffer((cur) => (cur?.id === offerId ? null : cur));
      } else if (event === 'delivery.updated') {
        void refreshLive();
        if ((data as { status?: string }).status === 'ENTREGUE') void refreshEarnings();
      }
    },
    [refreshEarnings, refreshLive],
  );

  useEffect(() => {
    if (!online) return;
    const c = new RealtimeClient({
      url: WS_URL,
      getToken: getAccessToken,
      refreshSession: () => api('/me').then(() => undefined),
      onStatus: setRealtime,
      onEvent: handleEvent,
    });
    client.current = c;
    c.start();
    return () => {
      c.stop();
      client.current = null;
    };
  }, [online, handleEvent]);

  // Sem WebSocket: consulta a cada 5 s (e já ao perder a conexão).
  useEffect(() => {
    if (!online || realtime === 'open') return;
    void refreshLive();
    const t = setInterval(() => void refreshLive(), POLL_MS);
    return () => clearInterval(t);
  }, [online, realtime, refreshLive]);

  // Voltou para o app ou a internet voltou: atualiza tudo.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && onlineRef.current) {
        void refreshLive();
        void refreshEarnings();
      }
    });
    return () => sub.remove();
  }, [refreshEarnings, refreshLive]);
  useEffect(() => {
    if (!offline && ready) void refreshLive();
  }, [offline, ready, refreshLive]);

  // Tocar no aviso de novo pedido abre o app: busca a oferta na hora.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => void refreshLive());
    return () => sub.remove();
  }, [refreshLive]);

  // Oferta vencida some da tela sem esperar o servidor avisar.
  useEffect(() => {
    if (!offer) return;
    const ms = new Date(offer.expiresAt).getTime() - Date.now();
    const t = setTimeout(
      () => setOffer((cur) => (cur?.id === offer.id ? null : cur)),
      Math.max(0, ms),
    );
    return () => clearTimeout(t);
  }, [offer]);

  // ------------------------------------------------------------------ localização

  const sendPosition = useCallback((p: Coords) => {
    setPosition(p);
    if (client.current?.sendPosition(p.lat, p.lng)) return;
    // WebSocket fechado: envia pelo REST, no máximo a cada 5 s.
    const now = Date.now();
    if (now - lastRest.current < REST_POSITION_EVERY_MS) return;
    lastRest.current = now;
    api<{ accepted: boolean }>('/driver/position', { body: p })
      .then((r) => {
        if (!r.accepted) setOnline(false); // o servidor já não nos considera online
      })
      .catch(() => {});
  }, []);

  const preciseNow = !!active;
  useEffect(() => {
    if (!online || !access || access === 'denied' || access === 'undetermined') return;
    const unsub = subscribePositions(sendPosition);
    let stop: (() => Promise<void>) | null = null;
    let cancelled = false;
    startTracking({ background: access === 'background', precise: preciseNow })
      .then((s) => {
        if (cancelled) void s();
        else stop = s;
      })
      .catch((e) => setActionError(errorMessage(e)));
    return () => {
      cancelled = true;
      unsub();
      void stop?.();
    };
  }, [online, access, preciseNow, sendPosition]);

  // ------------------------------------------------------------------ ações

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const goOnline = useCallback(
    () =>
      run(async () => {
        if (!consented) return setConsentOpen(true);
        let acc = await locationAccess();
        if (acc === 'undetermined') acc = await requestLocationAccess();
        setAccess(acc);
        if (acc === 'denied' || acc === 'undetermined')
          throw new Error(
            'Sem permissão de localização. Ative nas Configurações do celular para ficar online.',
          );
        const here = await currentPosition();
        const presence = await api<Presence>('/driver/presence/online', { body: here });
        setPosition(here);
        setOnline(presence.online);
        void registerForPush().then((r) => {
          pushToken.current = r.status === 'ok' ? r.token : null;
          setPushNote(
            r.status === 'ok'
              ? null
              : r.status === 'denied'
                ? 'Avisos desligados: você só vê pedidos com o app aberto.'
                : r.reason,
          );
        });
      }),
    [consented, run],
  );

  const goOffline = useCallback(
    () =>
      run(async () => {
        await api('/driver/presence/offline', { method: 'POST' });
        setOnline(false);
        setOffer(null);
        setRealtime('closed');
      }),
    [run],
  );

  const acceptConsent = useCallback(
    () =>
      run(async () => {
        await api('/driver/location-consent', { body: { version: LOCATION_CONSENT_VERSION } });
        setConsented(true);
        setConsentOpen(false);
        const acc = await requestLocationAccess();
        setAccess(acc);
        if (acc === 'denied')
          throw new Error(
            'Sem permissão de localização. Ative nas Configurações do celular para ficar online.',
          );
      }),
    [run],
  );

  const revokeConsent = useCallback(
    () =>
      run(async () => {
        if (onlineRef.current) await api('/driver/presence/offline', { method: 'POST' });
        await api('/driver/location-consent', { method: 'DELETE' });
        setOnline(false);
        setConsented(false);
      }),
    [run],
  );

  const accept = useCallback(
    () =>
      run(async () => {
        if (!offer) return;
        try {
          setActive(
            await api<ActiveDelivery>(`/driver/offers/${offer.id}/accept`, { method: 'POST' }),
          );
          setOffer(null);
        } catch (e) {
          setOffer(null); // venceu ou outro motorista pegou: a oferta não existe mais
          void refreshLive();
          throw e;
        }
      }),
    [offer, refreshLive, run],
  );

  const decline = useCallback(
    (reason?: string) =>
      run(async () => {
        if (!offer) return;
        await api(`/driver/offers/${offer.id}/decline`, {
          method: 'POST',
          body: reason ? { reason } : {},
        });
        setOffer(null);
      }),
    [offer, run],
  );

  const advance = useCallback(
    (pin?: string) =>
      run(async () => {
        const step = active && nextStep(active.status, active.kind);
        if (!active || !step) return;
        const next = await api<ActiveDelivery & { settlement?: { workerNetCents: number } | null }>(
          `/driver/deliveries/${active.id}/${step.path}`,
          { method: 'POST', ...(pin ? { body: { pin } } : {}) },
        );
        if (next.status === 'ENTREGUE') {
          setCompleted({
            fareCents: next.fareCents,
            workerNetCents: next.settlement?.workerNetCents ?? 0,
            ...(active.kind === 'CORRIDA' ? { rideId: active.id } : {}),
          });
          setActive(null);
          void refreshEarnings();
        } else setActive(next);
      }),
    [active, refreshEarnings, run],
  );

  const release = useCallback(
    () =>
      run(async () => {
        if (!active) return;
        await api(`/driver/deliveries/${active.id}/release`, { method: 'POST' });
        setActive(null);
      }),
    [active, run],
  );

  const cancelTrip = useCallback(
    async (category: string, effect: 'RELEASE' | 'CANCEL') => {
      if (!active) return false;
      let done = false;
      await run(async () => {
        if (effect === 'RELEASE')
          await api(`/driver/deliveries/${active.id}/release`, {
            method: 'POST',
            body: { category },
          });
        else
          await api(`/deliveries/${active.id}/cancel`, {
            method: 'POST',
            body: {
              reason:
                active.status === 'COLETADO' || active.status === 'A_CAMINHO_ENTREGA'
                  ? 'ENTREGA_IMPOSSIVEL'
                  : 'COLETA_IMPOSSIVEL',
              category,
            },
          });
        setActive(null);
        done = true;
      });
      return done;
    },
    [active, run],
  );

  const prepareSignOut = useCallback(async () => {
    if (onlineRef.current && !active)
      await api('/driver/presence/offline', { method: 'POST' }).catch(() => {});
    await unregisterPush(pushToken.current);
    setOnline(false);
  }, [active]);

  const value = useMemo<DriverValue>(
    () => ({
      ready,
      loadError,
      reload,
      online,
      busy,
      actionError,
      clearError: () => setActionError(null),
      position,
      offer,
      active,
      completed,
      dismissCompleted: () => setCompleted(null),
      earnings,
      earningsError,
      refreshEarnings,
      realtime,
      offline,
      access,
      consented,
      consentOpen,
      closeConsent: () => setConsentOpen(false),
      openSettings: () => void Linking.openSettings(),
      pushNote,
      goOnline,
      goOffline,
      acceptConsent,
      revokeConsent,
      accept,
      decline,
      advance,
      release,
      cancelTrip,
      subscribe,
      prepareSignOut,
    }),
    [
      ready,
      loadError,
      reload,
      online,
      busy,
      actionError,
      position,
      offer,
      active,
      completed,
      earnings,
      earningsError,
      refreshEarnings,
      realtime,
      offline,
      access,
      consented,
      consentOpen,
      pushNote,
      goOnline,
      goOffline,
      acceptConsent,
      revokeConsent,
      accept,
      decline,
      advance,
      release,
      cancelTrip,
      subscribe,
      prepareSignOut,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
