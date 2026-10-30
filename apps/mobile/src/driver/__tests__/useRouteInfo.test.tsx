import { act, renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../api';
import { REROUTE_MIN_MS, useRouteInfo } from '../useRouteInfo';
import { active } from '../../testing/fixtures';
import type { ActiveDelivery, Coords } from '../types';

jest.mock('../../api', () => ({ ...jest.requireActual('../../api'), api: jest.fn() }));
const mockApi = api as jest.Mock;

const route = {
  target: 'COLETA',
  destination: active.pickup,
  distanceMeters: 1,
  durationSeconds: 1,
  path: [],
};
const here: Coords = { lat: -7.12, lng: -34.86 };
type P = { a: ActiveDelivery | null; p: Coords | null };
const props = (a: ActiveDelivery | null, p: Coords | null): P => ({ a, p });
const hook = (initialProps: P) => renderHook((x: P) => useRouteInfo(x.a, x.p), { initialProps });

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockResolvedValue(route);
});

describe('useRouteInfo', () => {
  it('busca a rota da posição atual até o destino', async () => {
    const { result } = await hook(props(active, here));
    await waitFor(() => expect(result.current.route).toEqual(route));
    expect(mockApi).toHaveBeenCalledWith(`/driver/deliveries/d1/route?lat=-7.12&lng=-34.86`);
  });

  it('espera a primeira posição antes de pedir', async () => {
    await hook(props(active, null));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('não pede de novo a cada posição (só quando anda longe E passou o tempo)', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      const { rerender } = await hook(props(active, here));
      await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
      await rerender(props(active, { lat: -7.1201, lng: -34.86 })); // ~11 m
      expect(mockApi).toHaveBeenCalledTimes(1);
      await rerender(props(active, { lat: -7.13, lng: -34.86 })); // ~1,1 km, mas cedo demais
      expect(mockApi).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(REROUTE_MIN_MS + 1);
      });
      await rerender(props(active, { lat: -7.131, lng: -34.86 }));
      await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(2));
    } finally {
      jest.useRealTimers();
    }
  });

  it('muda de etapa: pede a rota para o novo destino na hora', async () => {
    const { rerender } = await hook(props(active, here));
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    await rerender(props({ ...active, status: 'COLETADO' }, here));
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(2));
  });

  it('falha: expõe o erro e tenta de novo na próxima posição', async () => {
    mockApi.mockRejectedValueOnce(new Error('Não foi possível traçar a rota agora'));
    const { result, rerender } = await hook(props(active, here));
    await waitFor(() => expect(result.current.error).toBe('Não foi possível traçar a rota agora'));
    await rerender(props(active, { lat: -7.1201, lng: -34.86 }));
    await waitFor(() => expect(result.current.route).toEqual(route));
    expect(result.current.error).toBeNull();
  });

  it('sem entrega em andamento limpa a rota', async () => {
    const { result, rerender } = await hook(props(active, here));
    await waitFor(() => expect(result.current.route).not.toBeNull());
    await rerender(props(null, here));
    expect(result.current.route).toBeNull();
  });
});
