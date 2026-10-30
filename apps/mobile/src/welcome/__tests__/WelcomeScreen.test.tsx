import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api } from '../../api';
import { historyItem, point, sent, welcomeRoutes } from '../../testing/welcomeFixtures';
import { WelcomeScreen } from '../WelcomeScreen';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});

beforeEach(() => (api as jest.Mock).mockReset());

const base = (): [string | RegExp, unknown][] => [
  [/^GET \/welcome-points\?/, []],
  ['GET /welcome-points/mine', []],
  ['GET /welcome-points/check-ins/mine', []],
  ['GET /welcome-points/reports/mine', []],
];
const checkIn = {
  id: 'c1',
  pointId: 'p1',
  startedAt: '2026-11-02T15:00:00Z',
  endedAt: null,
  completed: false,
  expiresAt: '2026-11-02T19:00:00Z',
  minMinutes: 5,
};

describe('tela de pontos de acolhida', () => {
  it('sem check-in aberto, mostra o mapa e as quatro seções', async () => {
    welcomeRoutes([
      ['GET /welcome-points/check-ins/active', { checkIn: null, point: null }],
      ...base(),
    ]);
    await render(<WelcomeScreen />);
    expect(await screen.findByText(/Nenhum ponto com esses filtros/)).toBeTruthy();
    for (const t of ['Mapa', 'Cadastrar', 'Meus', 'Visitas'])
      expect(screen.getByText(t)).toBeTruthy();
    expect(screen.queryByText('Sair do ponto')).toBeNull();
  });

  it('com check-in aberto, mostra onde está e, ao sair depois do mínimo, pede a avaliação', async () => {
    let open = true;
    welcomeRoutes([
      [
        'GET /welcome-points/check-ins/active',
        () =>
          open
            ? { checkIn, point: point({ name: 'Casa da Maria', address: 'Rua A, 1' }) }
            : { checkIn: null, point: null },
      ],
      [
        'POST /welcome-points/check-ins/c1/end',
        () => {
          open = false;
          return { ...checkIn, endedAt: '2026-11-02T15:40:00Z', completed: true, canRate: true };
        },
      ],
      ['POST /welcome-points/check-ins/c1/rate', { ok: true }],
      ...base(),
    ]);
    await render(<WelcomeScreen />);
    expect(await screen.findByText('Você está em Casa da Maria')).toBeTruthy();
    expect(screen.getByText(/Rua A, 1/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Sair do ponto'));
    expect(await screen.findByText('Como foi? Avalie o ponto')).toBeTruthy();
    expect(screen.queryByText('Você está em Casa da Maria')).toBeNull();
    await fireEvent.press(screen.getByLabelText('4 estrelas'));
    await fireEvent.press(screen.getByText('Enviar avaliação'));
    await waitFor(() =>
      expect(sent('POST', '/welcome-points/check-ins/c1/rate')[0]).toEqual({ stars: 4 }),
    );
    await waitFor(() => expect(screen.queryByText('Como foi? Avalie o ponto')).toBeNull());
  });

  it('visita curta demais não conta e não pede avaliação', async () => {
    welcomeRoutes([
      ['GET /welcome-points/check-ins/active', { checkIn, point: point() }],
      ['POST /welcome-points/check-ins/c1/end', { ...checkIn, completed: false, canRate: false }],
      ...base(),
    ]);
    await render(<WelcomeScreen />);
    await fireEvent.press(await screen.findByText('Sair do ponto'));
    expect(await screen.findByText(/Visita muito curta/)).toBeTruthy();
    expect(screen.queryByText('Enviar avaliação')).toBeNull();
  });

  it('erro ao sair mostra a mensagem e mantém o check-in', async () => {
    welcomeRoutes([
      ['GET /welcome-points/check-ins/active', { checkIn, point: point() }],
      [
        'POST /welcome-points/check-ins/c1/end',
        () => {
          throw new Error('Este check-in já foi encerrado');
        },
      ],
      ...base(),
    ]);
    await render(<WelcomeScreen />);
    await fireEvent.press(await screen.findByText('Sair do ponto'));
    expect(await screen.findByText('Este check-in já foi encerrado')).toBeTruthy();
    expect(screen.getByText('Sair do ponto')).toBeTruthy();
  });

  it('aba Visitas: avalia uma visita e acompanha as denúncias', async () => {
    welcomeRoutes([
      ['GET /welcome-points/check-ins/active', { checkIn: null, point: null }],
      [/^GET \/welcome-points\?/, []],
      [
        'GET /welcome-points/check-ins/mine',
        [historyItem(), historyItem({ id: 'c2', completed: false, canRate: false })],
      ],
      [
        'GET /welcome-points/reports/mine',
        [
          {
            id: 'r1',
            pointId: 'p9',
            pointName: 'Casa suspeita',
            category: 'SEGURANCA',
            status: 'PROCEDENTE',
            response: 'Ponto removido.',
            createdAt: '2026-11-01T12:00:00Z',
          },
        ],
      ],
      ['POST /welcome-points/check-ins/c1/rate', { ok: true }],
    ]);
    await render(<WelcomeScreen />);
    await fireEvent.press(await screen.findByText('Visitas'));
    expect(await screen.findByText('Casa suspeita')).toBeTruthy();
    expect(screen.getByText('Procedente')).toBeTruthy();
    expect(screen.getByText('Resposta: Ponto removido.')).toBeTruthy();
    expect(screen.getByText(/Visita curta ou encerrada sozinha/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Avaliar este ponto'));
    await fireEvent.press(screen.getByLabelText('3 estrelas'));
    await fireEvent.press(screen.getByText('Enviar avaliação'));
    await waitFor(() =>
      expect(sent('POST', '/welcome-points/check-ins/c1/rate')[0]).toEqual({ stars: 3 }),
    );
  });
});
