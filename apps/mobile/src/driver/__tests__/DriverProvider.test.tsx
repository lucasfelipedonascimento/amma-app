import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { LOCATION_CONSENT_VERSION } from '@amma/shared';
import { ApiError, api } from '../../api';
import { DriverProvider, useDriver } from '../DriverProvider';
import { offer, active } from '../../testing/fixtures';
import * as Location from 'expo-location';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), getAccessToken: () => 'tok', WS_URL: 'ws://x/ws' };
});
const mockApi = api as jest.Mock;

// O WebSocket de verdade não existe no Jest: um falso que nunca abre (a tela usa o REST).
class DeadSocket {
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  send() {}
  close() {}
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = DeadSocket;

type Routes = Record<string, unknown | ((body?: unknown) => unknown)>;
function mockServer(routes: Routes) {
  const calls: string[] = [];
  mockApi.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? (opts?.body ? 'POST' : 'GET');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push(key);
    const r = routes[key];
    if (r === undefined) throw new ApiError(404, `sem rota no teste: ${key}`);
    const out = typeof r === 'function' ? (r as (b?: unknown) => unknown)(opts?.body) : r;
    if (out instanceof Error) throw out;
    return out;
  });
  return calls;
}

const base: Routes = {
  'GET /driver/presence': { online: false, onlineSince: null, position: null },
  'GET /driver/location-consent': { version: LOCATION_CONSENT_VERSION, granted: true },
  'GET /driver/offers/current': null,
  'GET /driver/deliveries/active': null,
  'GET /driver/earnings': { today: {}, week: { days: [] }, history: [] },
};

function Probe({ onValue }: { onValue: (v: ReturnType<typeof useDriver>) => void }) {
  const v = useDriver();
  onValue(v);
  return (
    <>
      <Text testID="state">{`${v.ready ? 'ready' : 'loading'}|${v.online ? 'online' : 'offline'}|${v.consentOpen ? 'consent' : '-'}`}</Text>
      <Text testID="err">{v.actionError ?? v.loadError ?? ''}</Text>
    </>
  );
}

async function mount(): Promise<{ current: () => ReturnType<typeof useDriver> }> {
  let latest!: ReturnType<typeof useDriver>;
  await render(
    <DriverProvider>
      <Probe onValue={(v) => (latest = v)} />
    </DriverProvider>,
  );
  return { current: () => latest };
}
const state = () => screen.getByTestId('state').props.children as string;

beforeEach(() => {
  mockApi.mockReset();
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: true,
    status: 'granted',
  });
});

describe('DriverProvider', () => {
  it('carrega presença, consentimento, oferta e entrega ao abrir', async () => {
    const calls = mockServer({ ...base, 'GET /driver/offers/current': offer });
    const d = await mount();
    await waitFor(() => expect(state()).toBe('ready|offline|-'));
    expect(d.current().offer?.id).toBe('o1');
    expect(calls).toEqual(
      expect.arrayContaining(['GET /driver/presence', 'GET /driver/location-consent']),
    );
  });

  it('falha ao carregar (sem conexão) expõe o erro para a tela tentar de novo', async () => {
    mockServer({
      ...base,
      'GET /driver/presence': new ApiError(
        0,
        'Sem conexão com o servidor. Verifique sua internet.',
      ),
    });
    await mount();
    await waitFor(() => expect(screen.getByTestId('err').props.children).toMatch(/Sem conexão/));
    expect(state()).toMatch(/^loading/);
  });

  it('ficar online SEM consentimento abre a tela de consentimento e não liga o GPS', async () => {
    const calls = mockServer({
      ...base,
      'GET /driver/location-consent': { version: LOCATION_CONSENT_VERSION, granted: false },
    });
    const d = await mount();
    await waitFor(() => expect(state()).toMatch(/^ready/));
    await act(async () => d.current().goOnline());
    expect(state()).toBe('ready|offline|consent');
    expect(calls).not.toContain('POST /driver/presence/online');
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('aceitar o consentimento registra a versão certa e pede a permissão do sistema', async () => {
    let sent: unknown;
    mockServer({
      ...base,
      'GET /driver/location-consent': { version: LOCATION_CONSENT_VERSION, granted: false },
      'POST /driver/location-consent': (b?: unknown) => ((sent = b), { granted: true }),
    });
    const d = await mount();
    await waitFor(() => expect(state()).toMatch(/^ready/));
    await act(async () => d.current().goOnline());
    await act(async () => d.current().acceptConsent());
    expect(sent).toEqual({ version: LOCATION_CONSENT_VERSION });
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(state()).toBe('ready|offline|-');
    expect(d.current().consented).toBe(true);
  });

  it('com consentimento, ficar online envia a posição e liga o rastreamento', async () => {
    let body: unknown;
    mockServer({
      ...base,
      'POST /driver/presence/online': (b?: unknown) => (
        (body = b),
        { online: true, onlineSince: 'x', position: null }
      ),
      'PUT /driver/push-token': null,
    });
    const d = await mount();
    await waitFor(() => expect(state()).toMatch(/^ready/));
    await act(async () => d.current().goOnline());
    expect(body).toEqual({ lat: -7.115, lng: -34.861 });
    expect(state()).toBe('ready|online|-');
    await waitFor(() => expect(Location.startLocationUpdatesAsync).toHaveBeenCalled());
  });

  it('permissão de localização negada: não fica online e explica', async () => {
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
      status: 'denied',
    });
    const calls = mockServer(base);
    const d = await mount();
    await waitFor(() => expect(state()).toMatch(/^ready/));
    await act(async () => d.current().goOnline());
    expect(calls).not.toContain('POST /driver/presence/online');
    expect(screen.getByTestId('err').props.children).toMatch(/Sem permissão de localização/);
  });

  it('só com permissão "durante o uso" usa a leitura em primeiro plano, sem tarefa de fundo', async () => {
    (Location.getBackgroundPermissionsAsync as jest.Mock)
      .mockResolvedValueOnce({ granted: false })
      .mockResolvedValue({ granted: false });
    mockServer({
      ...base,
      'POST /driver/presence/online': { online: true, onlineSince: 'x', position: null },
      'PUT /driver/push-token': null,
    });
    const d = await mount();
    await waitFor(() => expect(state()).toMatch(/^ready/));
    (Location.startLocationUpdatesAsync as jest.Mock).mockClear();
    await act(async () => d.current().goOnline());
    await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalled());
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(d.current().access).toBe('foreground');
  });

  it('aceitar a oferta vira entrega em andamento', async () => {
    mockServer({
      ...base,
      'GET /driver/offers/current': offer,
      'POST /driver/offers/o1/accept': active,
    });
    const d = await mount();
    await waitFor(() => expect(d.current().offer).not.toBeNull());
    await act(async () => d.current().accept());
    expect(d.current().offer).toBeNull();
    expect(d.current().active?.id).toBe('d1');
  });

  it('oferta que venceu antes do toque: some e mostra o motivo', async () => {
    let expired = false;
    mockServer({
      ...base,
      // Depois da tentativa de aceitar, o servidor já não tem a oferta.
      'GET /driver/offers/current': () => (expired ? null : offer),
      'POST /driver/offers/o1/accept': () => {
        expired = true;
        return new ApiError(409, 'Oferta expirada');
      },
    });
    const d = await mount();
    await waitFor(() => expect(d.current().offer).not.toBeNull());
    await act(async () => d.current().accept());
    expect(d.current().offer).toBeNull();
    expect(screen.getByTestId('err').props.children).toBe('Oferta expirada');
  });

  it('concluir a última etapa encerra a entrega e guarda o resultado', async () => {
    mockServer({
      ...base,
      'GET /driver/deliveries/active': { ...active, status: 'A_CAMINHO_ENTREGA' },
      'POST /driver/deliveries/d1/delivered': {
        ...active,
        status: 'ENTREGUE',
        settlement: { workerNetCents: 968 },
      },
    });
    const d = await mount();
    await waitFor(() => expect(d.current().active).not.toBeNull());
    await act(async () => d.current().advance());
    expect(d.current().active).toBeNull();
    expect(d.current().completed).toEqual({ fareCents: 1100, workerNetCents: 968 });
  });

  it('revogar o consentimento fica offline e apaga o registro', async () => {
    const calls = mockServer({
      ...base,
      'GET /driver/presence': { online: false, onlineSince: null, position: null },
      'DELETE /driver/location-consent': null,
    });
    const d = await mount();
    await waitFor(() => expect(state()).toMatch(/^ready/));
    await act(async () => d.current().revokeConsent());
    expect(calls).toContain('DELETE /driver/location-consent');
    expect(d.current().consented).toBe(false);
  });
});
