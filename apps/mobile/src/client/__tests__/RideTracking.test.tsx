import { Alert, Linking, Share } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiError, api } from '../../api';
import { TrackingScreen } from '../screens/TrackingScreen';
import { clientValue, delivery, WithClient } from '../../testing/clientFixtures';
import type { ClientDelivery } from '../types';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), getAccessToken: jest.fn(() => 'tok') };
});
const mockApi = api as jest.Mock;

const ride: ClientDelivery = {
  ...delivery,
  kind: 'CORRIDA',
  status: 'A_CAMINHO_COLETA',
  vehicleType: 'CARRO',
  driver: { id: 'm1', name: 'Carlos Lima' },
  vehicle: { type: 'CARRO', plate: 'ABC1D23', model: 'Onix', year: 2022 },
  driverRating: { average: 4.6, count: 12 },
  boardingPin: '4821',
};

let current: ClientDelivery;
const setup = async (d: ClientDelivery) => {
  current = d;
  mockApi.mockImplementation(async (path: string, opts?: { body?: { stars: number } }) => {
    if (path === `/deliveries/${d.id}`) return current;
    if (path === `/rides/${d.id}/shares`)
      return { id: 's1', token: 'tkn', url: 'https://amma.test/share/tkn' };
    if (path === '/safety/emergency') return { id: 'e1', status: 'ABERTO' };
    if (path === '/safety/reports') return { id: 'r1', status: 'ABERTA' };
    if (path.endsWith('/rating')) {
      current = { ...current, rating: { stars: opts!.body!.stars, comment: null, at: 'x' } };
      return current;
    }
    if (path.endsWith('/cancel')) {
      current = { ...current, status: 'CANCELADO', cancelReason: 'CLIENTE_DESISTIU' };
      return current;
    }
    throw new ApiError(404, path);
  });
  await render(
    <WithClient value={clientValue()}>
      <TrackingScreen id={d.id} onBack={jest.fn()} onReceipt={jest.fn()} />
    </WithClient>,
  );
};

beforeEach(() => {
  mockApi.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Acompanhar corrida', () => {
  it('fala em corrida, não em entrega: estado, saída e destino', async () => {
    await setup(ride);
    expect(await screen.findByText('Motorista a caminho de você')).toBeTruthy();
    expect(screen.getByText('Saída')).toBeTruthy();
    expect(screen.getByText('Destino')).toBeTruthy();
    expect(screen.queryByText('Coleta')).toBeNull();
    expect(screen.getByText('Cancelar corrida')).toBeTruthy();
    expect(screen.getByText('Pagamento e busca')).toBeTruthy();
    expect(screen.getByText('Motorista a caminho')).toBeTruthy();
  });

  it('o passageiro confere nome, nota, placa, modelo e vê o PIN de embarque', async () => {
    await setup(ride);
    await screen.findByText('Confira o motorista');
    expect(screen.getByText('Carlos Lima')).toBeTruthy();
    expect(screen.getByText('★ 4,6 (12 avaliações)')).toBeTruthy();
    expect(screen.getByTestId('vehicle-plate').props.children).toBe('ABC1D23');
    expect(screen.getByText('Onix · 2022')).toBeTruthy();
    expect(screen.getByTestId('boarding-pin').props.children).toBe('4821');
    expect(screen.getByTestId('driver-photo').props.source.uri).toMatch(
      /\/rides\/d1\/driver-photo$/,
    );
    expect(screen.getByTestId('driver-photo').props.source.headers.authorization).toBe(
      'Bearer tok',
    );
  });

  it('depois de embarcar o PIN some', async () => {
    await setup({ ...ride, status: 'A_CAMINHO_ENTREGA', boardingPin: null });
    await screen.findByTestId('vehicle-plate');
    expect(screen.getAllByText('Em viagem').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('boarding-pin')).toBeNull();
    expect(screen.getByTestId('vehicle-plate')).toBeTruthy();
    expect(screen.queryByText('Cancelar corrida')).toBeNull();
  });

  it('entrega comum não ganha cartão de motorista nem de segurança', async () => {
    await setup({ ...delivery, status: 'A_CAMINHO_COLETA', driver: { id: 'm1', name: 'Maria' } });
    await screen.findByText('Motorista indo à coleta');
    expect(screen.queryByText('Confira o motorista')).toBeNull();
    expect(screen.queryByText('Segurança')).toBeNull();
    expect(screen.queryByText('Compartilhar minha viagem')).toBeNull();
  });

  describe('compartilhar a viagem', () => {
    it('gera o link e o entrega ao compartilhamento do sistema', async () => {
      const share = jest
        .spyOn(Share, 'share')
        .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
      await setup(ride);
      await fireEvent.press(await screen.findByText('Compartilhar minha viagem'));
      await waitFor(() => expect(share).toHaveBeenCalled());
      expect(share.mock.calls[0][0].message).toContain('https://amma.test/share/tkn');
      expect(mockApi).toHaveBeenCalledWith('/rides/d1/shares', { body: {} });
      expect(await screen.findByText(/Link enviado/)).toBeTruthy();
    });

    it('erro ao gerar o link aparece na tela e nada é compartilhado', async () => {
      const share = jest.spyOn(Share, 'share');
      await setup(ride);
      mockApi.mockImplementation(async (path: string) => {
        if (path === '/rides/d1/shares') throw new ApiError(409, 'Limite de 5 links por corrida');
        return current;
      });
      await fireEvent.press(await screen.findByText('Compartilhar minha viagem'));
      expect(await screen.findByText('Limite de 5 links por corrida')).toBeTruthy();
      expect(share).not.toHaveBeenCalled();
    });

    it('depois que a corrida acaba só resta denunciar', async () => {
      await setup({ ...ride, status: 'ENTREGUE', boardingPin: null });
      await screen.findByText('Viagem concluída');
      expect(screen.queryByText('Compartilhar minha viagem')).toBeNull();
      expect(screen.queryByText('🚨 Emergência')).toBeNull();
      expect(screen.getByText('Denunciar')).toBeTruthy();
    });
  });

  describe('emergência', () => {
    it('avisa a associação com a corrida e a posição, e liga para o 190', async () => {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      (Linking.openURL as jest.Mock).mockClear();
      await setup(ride);
      await fireEvent.press(await screen.findByText('🚨 Emergência'));
      const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
        text: string;
        onPress?: () => void;
      }[];
      await act(async () => {
        buttons.find((b) => b.text.includes('190'))!.onPress!();
      });
      expect(open).toHaveBeenCalledWith('tel:190');
      await waitFor(() =>
        expect(mockApi).toHaveBeenCalledWith('/safety/emergency', {
          body: { deliveryId: 'd1', lat: -7.115, lng: -34.861 },
        }),
      );
      expect(await screen.findByText(/A associação foi avisada/)).toBeTruthy();
    });

    it('sem internet o aviso falha, mas a ligação acontece e o texto manda ligar', async () => {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      (Linking.openURL as jest.Mock).mockClear();
      await setup(ride);
      mockApi.mockImplementation(async (path: string) => {
        if (path === '/safety/emergency') throw new ApiError(0, 'Sem conexão');
        return current;
      });
      await fireEvent.press(await screen.findByText('🚨 Emergência'));
      const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
        text: string;
        onPress?: () => void;
      }[];
      await act(async () => {
        buttons.find((b) => b.text.includes('192'))!.onPress!();
      });
      expect(open).toHaveBeenCalledWith('tel:192');
      expect(await screen.findByText(/Não conseguimos avisar a associação/)).toBeTruthy();
    });

    it('"só avisar a associação" não liga para ninguém', async () => {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      (Linking.openURL as jest.Mock).mockClear();
      await setup(ride);
      await fireEvent.press(await screen.findByText('🚨 Emergência'));
      const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
        text: string;
        onPress?: () => void;
      }[];
      await act(async () => {
        buttons.find((b) => b.text === 'Só avisar a associação')!.onPress!();
      });
      expect(open).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockApi).toHaveBeenCalledWith('/safety/emergency', expect.anything()),
      );
    });
  });

  describe('denúncia', () => {
    it('exige categoria e descrição; envia ligada à corrida', async () => {
      await setup(ride);
      await fireEvent.press(await screen.findByText('Denunciar'));
      await fireEvent.press(screen.getByText('Enviar denúncia'));
      expect(screen.getByText('Escolha o que aconteceu.')).toBeTruthy();
      await fireEvent.press(screen.getByText('Direção perigosa'));
      await fireEvent.changeText(screen.getByLabelText('O que aconteceu?'), 'curto');
      await fireEvent.press(screen.getByText('Enviar denúncia'));
      expect(screen.getByText(/pelo menos 10 letras/)).toBeTruthy();
      expect(mockApi).not.toHaveBeenCalledWith('/safety/reports', expect.anything());
      await fireEvent.changeText(
        screen.getByLabelText('O que aconteceu?'),
        'Furou o sinal vermelho duas vezes.',
      );
      await fireEvent.press(screen.getByText('Enviar denúncia'));
      expect(await screen.findByText('Denúncia enviada')).toBeTruthy();
      expect(mockApi).toHaveBeenCalledWith('/safety/reports', {
        body: {
          deliveryId: 'd1',
          category: 'DIRECAO_PERIGOSA',
          description: 'Furou o sinal vermelho duas vezes.',
        },
      });
    });

    it('o app nunca envia o id da pessoa denunciada', async () => {
      await setup(ride);
      await fireEvent.press(await screen.findByText('Denunciar'));
      await fireEvent.press(screen.getByText('Assédio'));
      await fireEvent.changeText(
        screen.getByLabelText('O que aconteceu?'),
        'Fez comentários impróprios.',
      );
      await fireEvent.press(screen.getByText('Enviar denúncia'));
      await screen.findByText('Denúncia enviada');
      const body = mockApi.mock.calls.find((c) => c[0] === '/safety/reports')![1].body;
      expect(Object.keys(body).sort()).toEqual(['category', 'deliveryId', 'description']);
    });
  });

  it('avaliação da viagem: pede a nota da viagem e mostra a enviada', async () => {
    await setup({ ...ride, status: 'ENTREGUE', boardingPin: null });
    expect(await screen.findByText('Como foi a viagem?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('star-5'));
    await fireEvent.press(screen.getByText('Enviar avaliação'));
    expect(await screen.findByText('Sua avaliação')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/deliveries/d1/rating', {
      body: { stars: 5, comment: undefined },
    });
  });

  it('cancelar a corrida usa o motivo do cliente e o texto de corrida', async () => {
    await setup({ ...ride, status: 'OFERECIDO', driver: null, boardingPin: '4821' });
    await fireEvent.press(await screen.findByText('Cancelar corrida'));
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Cancelar corrida?');
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Cancelar corrida')!.onPress!();
    });
    expect(mockApi).toHaveBeenCalledWith('/deliveries/d1/cancel', {
      body: { reason: 'CLIENTE_DESISTIU' },
    });
    expect(await screen.findByText('Você cancelou a corrida.')).toBeTruthy();
  });
});
