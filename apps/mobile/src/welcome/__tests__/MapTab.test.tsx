import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { api } from '../../api';
import { paths, point, welcomeRoutes } from '../../testing/welcomeFixtures';
import { MapTab } from '../MapTab';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});

beforeEach(() => (api as jest.Mock).mockReset());

const LIST = /^GET \/welcome-points\?/;
const lastList = () =>
  paths()
    .filter((p) => p.startsWith('/welcome-points?'))
    .at(-1)!;

describe('mapa de pontos de acolhida', () => {
  it('mostra os pontos perto, com tipo, distância, comodidades, nota e se está aberto', async () => {
    welcomeRoutes([
      [
        LIST,
        [
          point(),
          point({
            id: 'p2',
            name: 'Praça do Ponto',
            type: 'ESPACO_PUBLICO',
            openNow: false,
            occupied: 4,
            rating: { average: null, count: 1 },
            distanceMeters: 1800,
          }),
        ],
      ],
    ]);
    await render(<MapTab onCheckedIn={jest.fn()} />);
    expect(await screen.findByText('Padaria Boa Hora')).toBeTruthy();
    expect(screen.getByText('Comércio · Manaíra · 450 m')).toBeTruthy();
    expect(screen.getAllByText('Água · Banheiro')).toHaveLength(2);
    expect(screen.getByText('★ 4,3 (12 avaliações)')).toBeTruthy();
    expect(screen.getAllByText('Aberto agora')).toHaveLength(2); // filtro + etiqueta do cartão
    expect(screen.getByText('Fechado agora')).toBeTruthy();
    expect(screen.getByText('Lotado')).toBeTruthy();
    expect(screen.getByText('Espaço público · Manaíra · 1,8 km')).toBeTruthy();
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
  });

  it('pede a API perto da posição do aparelho e refaz a busca a cada filtro', async () => {
    welcomeRoutes([[LIST, []]]);
    await render(<MapTab onCheckedIn={jest.fn()} />);
    await waitFor(() => expect(lastList()).toContain('lat=-7.115&lng=-34.861&radiusMeters=5000'));
    await fireEvent.press(screen.getByText('Casa parceira'));
    await waitFor(() => expect(lastList()).toContain('types=CASA_PARCEIRA'));
    await fireEvent.press(screen.getByText('Água'));
    await fireEvent.press(screen.getByText('Carregador'));
    await waitFor(() => expect(lastList()).toContain('amenities=AGUA,CARREGADOR'));
    await fireEvent.press(screen.getByText('Aberto agora'));
    await waitFor(() => expect(lastList()).toContain('openNow=true'));
    await fireEvent.press(screen.getByText('1 km'));
    await waitFor(() => expect(lastList()).toContain('radiusMeters=1000'));
    await fireEvent.press(screen.getByText('4+'));
    await waitFor(() => expect(lastList()).toContain('minRating=4'));
    // Desmarcar tira o filtro.
    await fireEvent.press(screen.getByText('Casa parceira'));
    await waitFor(() => expect(lastList()).not.toContain('types='));
  });

  it('sem pontos, sugere afrouxar os filtros', async () => {
    welcomeRoutes([[LIST, []]]);
    await render(<MapTab onCheckedIn={jest.fn()} />);
    expect(await screen.findByText(/Nenhum ponto com esses filtros/)).toBeTruthy();
  });

  it('sem permissão de localização, avisa e usa o centro de João Pessoa', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      status: 'denied',
    });
    welcomeRoutes([[LIST, []]]);
    await render(<MapTab onCheckedIn={jest.fn()} />);
    expect(await screen.findByText(/Mostrando perto do centro de João Pessoa/)).toBeTruthy();
    expect(lastList()).toContain('lat=-7.115&lng=-34.861');
  });

  it('erro da API mostra "Tentar de novo"', async () => {
    (api as jest.Mock).mockRejectedValue(new Error('Sem conexão'));
    await render(<MapTab onCheckedIn={jest.fn()} />);
    expect(await screen.findByText('Sem conexão')).toBeTruthy();
    expect(screen.getByText('Tentar de novo')).toBeTruthy();
  });

  it('tocar num ponto abre o detalhe e voltar recarrega a lista', async () => {
    welcomeRoutes([
      [LIST, [point()]],
      [/^GET \/welcome-points\/p1\?/, point()],
    ]);
    await render(<MapTab onCheckedIn={jest.fn()} />);
    await fireEvent.press(await screen.findByLabelText('Padaria Boa Hora'));
    expect(await screen.findByText('Fazer check-in aqui')).toBeTruthy();
    const before = paths().filter((p) => p.startsWith('/welcome-points?')).length;
    await fireEvent.press(screen.getByText('‹ Voltar'));
    await waitFor(() =>
      expect(paths().filter((p) => p.startsWith('/welcome-points?')).length).toBeGreaterThan(
        before,
      ),
    );
  });
});
