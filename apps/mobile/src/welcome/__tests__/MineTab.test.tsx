import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api } from '../../api';
import { point, sent, visit, welcomeRoutes } from '../../testing/welcomeFixtures';
import { MineTab } from '../MineTab';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});

beforeEach(() => (api as jest.Mock).mockReset());

const house = (over = {}) =>
  point({
    id: 'h1',
    type: 'CASA_PARCEIRA',
    name: 'Casa da Maria',
    status: 'ATIVO',
    benefitKind: 'CREDITO',
    isOwner: true,
    ...over,
  });

describe('meus pontos', () => {
  it('lista com a situação e o motivo de quem não está no mapa', async () => {
    welcomeRoutes([
      [
        'GET /welcome-points/mine',
        [
          house({ status: 'EM_ANALISE' }),
          house({
            id: 'h2',
            name: 'Casa do João',
            status: 'RECUSADO',
            statusNote: 'Endereço não encontrado',
          }),
        ],
      ],
    ]);
    await render(<MineTab />);
    expect(await screen.findByText('Casa da Maria')).toBeTruthy();
    expect(screen.getByText('Em análise')).toBeTruthy();
    expect(screen.getByText('Recusado')).toBeTruthy();
    expect(screen.getByText('Endereço não encontrado')).toBeTruthy();
  });

  it('sem pontos, orienta a cadastrar', async () => {
    welcomeRoutes([['GET /welcome-points/mine', []]]);
    await render(<MineTab />);
    expect(await screen.findByText(/ainda não cadastrou nenhum ponto/)).toBeTruthy();
  });

  it('gerenciar: troca o benefício e mostra o endereço completo', async () => {
    welcomeRoutes([
      ['GET /welcome-points/mine', [house()]],
      ['GET /welcome-points/h1', house()],
      ['GET /welcome-points/h1/visits', []],
      ['PATCH /welcome-points/h1', house({ benefitKind: 'DESCONTO' })],
    ]);
    await render(<MineTab />);
    await fireEvent.press(await screen.findByLabelText('Casa da Maria'));
    expect(await screen.findByText('Benefício por visita')).toBeTruthy();
    expect(screen.getByText(/Rua das Flores, 100/)).toBeTruthy();
    expect(screen.getByText('Ninguém visitou ainda.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Desconto nas taxas'));
    await waitFor(() =>
      expect(sent('PATCH', '/welcome-points/h1')[0]).toEqual({ benefitKind: 'DESCONTO' }),
    );
  });

  it('avalia o visitante com nota e comentário', async () => {
    let rated = false;
    welcomeRoutes([
      ['GET /welcome-points/mine', [house()]],
      ['GET /welcome-points/h1', house()],
      ['GET /welcome-points/h1/visits', () => [visit({ rated, canRate: !rated })]],
      [
        'POST /welcome-points/check-ins/v1/rate-visitor',
        () => {
          rated = true;
          return { ok: true };
        },
      ],
    ]);
    await render(<MineTab />);
    await fireEvent.press(await screen.findByLabelText('Casa da Maria'));
    expect(await screen.findByText(/Ana · .* · 40 min · 1 avaliação/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Avaliar Ana'));
    await fireEvent.press(screen.getByText('Enviar avaliação'));
    expect(screen.getByText('Escolha de 1 a 5 estrelas.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('5 estrelas'));
    await fireEvent.changeText(screen.getByLabelText('Comentário (opcional)'), 'Educada');
    await fireEvent.press(screen.getByText('Enviar avaliação'));
    await waitFor(() =>
      expect(sent('POST', '/welcome-points/check-ins/v1/rate-visitor')[0]).toEqual({
        stars: 5,
        comment: 'Educada',
      }),
    );
    expect(await screen.findByText('Avaliado')).toBeTruthy();
  });

  it('comércio não oferece benefício; remover pede confirmação e volta para a lista', async () => {
    welcomeRoutes([
      ['GET /welcome-points/mine', [point({ isOwner: true, status: 'ATIVO' })]],
      ['GET /welcome-points/p1', point({ isOwner: true, status: 'ATIVO' })],
      ['GET /welcome-points/p1/visits', []],
      ['DELETE /welcome-points/p1', null],
    ]);
    await render(<MineTab />);
    await fireEvent.press(await screen.findByLabelText('Padaria Boa Hora'));
    await screen.findByText('Fotos (0/6)');
    expect(screen.queryByText('Benefício por visita')).toBeNull();
    await fireEvent.press(screen.getByText('Remover ponto'));
    expect(sent('DELETE', '/welcome-points/p1')).toHaveLength(0);
    await fireEvent.press(screen.getByText('Confirmar: remover este ponto'));
    await waitFor(() =>
      expect(
        (api as jest.Mock).mock.calls.some(
          ([p, o]) => p === '/welcome-points/p1' && o?.method === 'DELETE',
        ),
      ).toBe(true),
    );
    expect(await screen.findByLabelText('Padaria Boa Hora')).toBeTruthy();
  });
});
