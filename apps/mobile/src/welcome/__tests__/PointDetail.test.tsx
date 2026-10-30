import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, ApiError } from '../../api';
import { point, sent, welcomeRoutes } from '../../testing/welcomeFixtures';
import { PointDetail } from '../PointDetail';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});

beforeEach(() => (api as jest.Mock).mockReset());

const GET = /^GET \/welcome-points\/p1\?lat=-7\.115&lng=-34\.861$/;
const open = (onCheckedIn = jest.fn()) =>
  render(
    <PointDetail
      id="p1"
      pos={{ lat: -7.115, lng: -34.861 }}
      onBack={jest.fn()}
      onCheckedIn={onCheckedIn}
    />,
  );

describe('detalhe do ponto', () => {
  it('mostra horário, vagas, avaliação e endereço de um comércio', async () => {
    welcomeRoutes([[GET, point()]]);
    await open();
    expect(await screen.findByText('Padaria Boa Hora')).toBeTruthy();
    expect(screen.getByText('24 horas')).toBeTruthy();
    expect(screen.getByText('1 de 4 ocupadas')).toBeTruthy();
    expect(screen.getByText('★ 4,3 (12 avaliações)')).toBeTruthy();
    expect(screen.getByText('Rua das Flores, 100')).toBeTruthy();
  });

  it('casa parceira: explica que o endereço só aparece no check-in', async () => {
    welcomeRoutes([
      [
        GET,
        point({ type: 'CASA_PARCEIRA', address: null, approximate: true, name: 'Casa da Maria' }),
      ],
    ]);
    await open();
    expect(
      await screen.findByText(/o endereço completo aparece quando você fizer o check-in/),
    ).toBeTruthy();
    expect(screen.queryByText('Rua das Flores, 100')).toBeNull();
  });

  it('check-in manda a posição do aparelho e avisa a tela', async () => {
    const onCheckedIn = jest.fn();
    welcomeRoutes([
      [GET, point()],
      ['POST /welcome-points/p1/check-in', { checkIn: { id: 'c1' } }],
    ]);
    await open(onCheckedIn);
    await fireEvent.press(await screen.findByText('Fazer check-in aqui'));
    await waitFor(() => expect(onCheckedIn).toHaveBeenCalled());
    expect(sent('POST', '/welcome-points/p1/check-in')[0]).toEqual({ lat: -7.115, lng: -34.861 });
  });

  it('mostra o erro da API quando o check-in é recusado (longe demais)', async () => {
    welcomeRoutes([
      [GET, point()],
      [
        'POST /welcome-points/p1/check-in',
        () => {
          throw new ApiError(409, 'Você precisa estar a até 200 m do ponto (está a 540 m)');
        },
      ],
    ]);
    const onCheckedIn = jest.fn();
    await open(onCheckedIn);
    await fireEvent.press(await screen.findByText('Fazer check-in aqui'));
    expect(await screen.findByText(/está a 540 m/)).toBeTruthy();
    expect(onCheckedIn).not.toHaveBeenCalled();
  });

  it('o botão de check-in fica desligado quando está fechado ou lotado', async () => {
    welcomeRoutes([[GET, point({ openNow: false })]]);
    await open();
    await fireEvent.press(await screen.findByText('Fazer check-in aqui'));
    expect(sent('POST', '/welcome-points/p1/check-in')).toHaveLength(0);
  });

  it('o dono não vê check-in nem denúncia', async () => {
    welcomeRoutes([[GET, point({ isOwner: true, status: 'ATIVO' })]]);
    await open();
    expect(await screen.findByText(/Este ponto é seu/)).toBeTruthy();
    expect(screen.queryByText('Fazer check-in aqui')).toBeNull();
    expect(screen.queryByText('Denunciar este ponto')).toBeNull();
  });

  it('denúncia: exige o motivo, envia e confirma', async () => {
    welcomeRoutes([
      [GET, point()],
      ['POST /welcome-points/p1/reports', { id: 'r1' }],
    ]);
    await open();
    await fireEvent.press(await screen.findByText('Denunciar este ponto'));
    await fireEvent.press(screen.getByText('Enviar denúncia'));
    expect(screen.getByText('Escolha o motivo da denúncia.')).toBeTruthy();
    expect(sent('POST', '/welcome-points/p1/reports')).toHaveLength(0);
    await fireEvent.press(screen.getByText('Cobrança indevida'));
    await fireEvent.changeText(
      screen.getByLabelText('Conte com detalhes (opcional)'),
      'Pediram dinheiro',
    );
    await fireEvent.press(screen.getByText('Enviar denúncia'));
    expect(await screen.findByText('Denúncia enviada. A associação vai analisar.')).toBeTruthy();
    expect(sent('POST', '/welcome-points/p1/reports')[0]).toEqual({
      category: 'COBRANCA_INDEVIDA',
      text: 'Pediram dinheiro',
    });
  });

  it('denúncia repetida mostra o aviso da API', async () => {
    welcomeRoutes([
      [GET, point()],
      [
        'POST /welcome-points/p1/reports',
        () => {
          throw new ApiError(409, 'Você já tem uma denúncia aberta sobre este ponto');
        },
      ],
    ]);
    await open();
    await fireEvent.press(await screen.findByText('Denunciar este ponto'));
    await fireEvent.press(screen.getByText('Outro motivo'));
    await fireEvent.press(screen.getByText('Enviar denúncia'));
    expect(
      await screen.findByText('Você já tem uma denúncia aberta sobre este ponto'),
    ).toBeTruthy();
  });
});
