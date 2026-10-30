import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, ApiError } from '../../api';
import { plain } from '../../testing/fixtures';
import { SummaryTab } from '../SummaryTab';
import { calls, me, routes } from '../../testing/associationFixtures';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});

beforeEach(() => (api as jest.Mock).mockReset());

describe('resumo da associação', () => {
  it('mostra nível, cotas, barra de progresso e o que falta para o próximo nível', async () => {
    routes({ 'GET /association/me': me(), 'GET /association/surplus': [] });
    await render(<SummaryTab />);
    expect(await screen.findByText('Seu nível: Bronze')).toBeTruthy();
    expect(screen.getByTestId('quotas').props.children).toBe('12');
    expect(screen.getByTestId('level-bar').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '40%' })]),
    );
    expect(plain(screen.getByTestId('next-level').props.children.join(''))).toBe(
      'Faltam 18 cotas (R$ 88,60 em taxa) para o nível Prata.',
    );
    expect(screen.getByText('Sócio')).toBeTruthy();
  });

  it('Ouro não tem próximo nível', async () => {
    routes({
      'GET /association/me': me({
        quotas: 70,
        progress: {
          level: 'GOLD',
          nextLevel: null,
          quotasToNext: null,
          centsToNext: null,
          percent: 100,
        },
      }),
      'GET /association/surplus': [],
    });
    await render(<SummaryTab />);
    expect(await screen.findByText('Você está no nível mais alto.')).toBeTruthy();
  });

  it('quem ainda não tem cota vê o aviso de que não é sócio', async () => {
    routes({
      'GET /association/me': me({ quotas: 0, remainderCents: 0, isMember: false }),
      'GET /association/surplus': [],
    });
    await render(<SummaryTab />);
    expect(await screen.findByText(/ainda não é sócio/)).toBeTruthy();
    expect(screen.queryByText('Sócio')).toBeNull();
  });

  it('trocar a taxa chama a API e recarrega o resumo', async () => {
    let rate = 2;
    routes({
      'GET /association/me': () => me({ associationRate: rate as 2 | 4 }),
      'GET /association/surplus': [],
      'PUT /driver/association-rate': (o: { body: { rate: number } }) => {
        rate = o.body.rate;
        return { associationRate: rate };
      },
    });
    await render(<SummaryTab />);
    await screen.findByText('Taxa da associação');
    await fireEvent.press(screen.getByText('4%'));
    await waitFor(() =>
      expect(calls('PUT', '/driver/association-rate')[0]![1]).toMatchObject({ body: { rate: 4 } }),
    );
    await waitFor(() => expect(calls('GET', '/association/me')).toHaveLength(2));
  });

  it('erro ao trocar a taxa aparece na tela', async () => {
    routes({
      'GET /association/me': me(),
      'GET /association/surplus': [],
      'PUT /driver/association-rate': () => {
        throw new ApiError(409, 'Preencha seus dados de motorista primeiro');
      },
    });
    await render(<SummaryTab />);
    await screen.findByText('Taxa da associação');
    await fireEvent.press(screen.getByText('0%'));
    expect(await screen.findByText('Preencha seus dados de motorista primeiro')).toBeTruthy();
  });

  it('lista as sobras recebidas; sem nenhuma, explica como funcionam', async () => {
    routes({
      'GET /association/me': me(),
      'GET /association/surplus': [
        {
          year: 2025,
          amountCents: 31_250,
          quotas: 10,
          useCents: 100_000,
          useWeightPercent: 50,
          closedAt: '2026-01-10T12:00:00Z',
        },
      ],
    });
    await render(<SummaryTab />);
    expect(await screen.findByText('Sobras de 2025')).toBeTruthy();
    expect(plain(screen.getByText(/10 cotas/).props.children.join(''))).toMatch(
      /R\$ 1\.000,00 em corridas · 50% pelo uso/,
    );
  });

  it('sem sobras fechadas', async () => {
    routes({ 'GET /association/me': me(), 'GET /association/surplus': [] });
    await render(<SummaryTab />);
    expect(await screen.findByText(/Ainda não há sobras fechadas/)).toBeTruthy();
  });

  it('falha ao carregar permite tentar de novo', async () => {
    (api as jest.Mock).mockRejectedValue(new ApiError(0, 'Sem conexão com o servidor.'));
    await render(<SummaryTab />);
    expect(await screen.findByText('Sem conexão com o servidor.')).toBeTruthy();
    routes({ 'GET /association/me': me(), 'GET /association/surplus': [] });
    await fireEvent.press(screen.getAllByText('Tentar de novo')[0]!);
    expect(await screen.findByText('Seu nível: Bronze')).toBeTruthy();
  });
});
