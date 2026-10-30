import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api } from '../../api';
import { DriverHome } from '../screens/DriverHome';
import { ActiveDeliveryScreen } from '../screens/ActiveDeliveryScreen';
import { OfferCard } from '../components/OfferCard';
import { StepProgress } from '../components/StepProgress';
import { active, driverValue, offer, WithDriver } from '../../testing/fixtures';
import type { ActiveDelivery } from '../types';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});
const mockApi = api as jest.Mock;

jest.mock('../useRouteInfo', () => ({ useRouteInfo: () => ({ route: null, error: null }) }));

jest.mock('../../session', () => ({ useSession: () => ({ me: { name: 'Carlos Lima' } }) }));

const rideOffer = {
  ...offer,
  kind: 'CORRIDA' as const,
  vehicleType: 'CARRO' as const,
  womenDriverOnly: false,
  passenger: { firstName: 'Ana', rating: { average: 4.8, count: 7 } },
};
const rideActive = (status: ActiveDelivery['status']): ActiveDelivery => ({
  ...active,
  kind: 'CORRIDA',
  status,
  passenger: { firstName: 'Ana', rating: { average: 4.8, count: 7 } },
});

beforeEach(() => {
  mockApi.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('oferta de corrida', () => {
  it('diz que é corrida, o tipo, o passageiro com a nota e usa embarque/destino', async () => {
    await render(<OfferCard offer={rideOffer} onAccept={jest.fn()} onDecline={jest.fn()} />);
    expect(screen.getByText('Nova corrida')).toBeTruthy();
    expect(screen.getByText('Carro')).toBeTruthy();
    expect(screen.getByTestId('offer-passenger').props.children.join('')).toBe(
      'Passageiro: Ana · ★ 4,8 (7 avaliações)',
    );
    expect(screen.getByText('Embarque')).toBeTruthy();
    expect(screen.getByText('Destino')).toBeTruthy();
    expect(screen.getByText(/até o passageiro/)).toBeTruthy();
    expect(screen.queryByText('Coleta')).toBeNull();
    // O dinheiro continua explícito.
    expect(screen.getByText('Taxa base (10%)')).toBeTruthy();
  });

  it('pedido de motorista mulher aparece como tal', async () => {
    await render(
      <OfferCard
        offer={{ ...rideOffer, womenDriverOnly: true }}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />,
    );
    expect(screen.getByText('Motorista mulher')).toBeTruthy();
  });

  it('entrega continua igual', async () => {
    await render(<OfferCard offer={offer} onAccept={jest.fn()} onDecline={jest.fn()} />);
    expect(screen.getByText('Novo pedido')).toBeTruthy();
    expect(screen.getByText('Coleta')).toBeTruthy();
    expect(screen.queryByTestId('offer-passenger')).toBeNull();
  });
});

describe('corrida em andamento', () => {
  const renderRide = (status: ActiveDelivery['status'], over = {}) =>
    render(
      <WithDriver value={driverValue({ online: true, active: rideActive(status), ...over })}>
        <ActiveDeliveryScreen />
      </WithDriver>,
    );

  it('mostra o passageiro e fala em passageiro, não em coleta', async () => {
    await renderRide('ACEITO');
    expect(screen.getByText('Ir buscar o passageiro em')).toBeTruthy();
    expect(screen.getByTestId('passenger-line').props.children.join('')).toBe(
      'Passageiro: Ana · ★ 4,8 (7 avaliações)',
    );
    expect(screen.getByText('Ir buscar o passageiro')).toBeTruthy();
    expect(screen.getByText('Buscando o passageiro')).toBeTruthy();
  });

  it('o embarque exige o PIN: botão desligado até 4 dígitos, e só números', async () => {
    const advance = jest.fn(async () => undefined);
    await renderRide('A_CAMINHO_COLETA', { advance });
    expect(screen.getByText('PIN de embarque')).toBeTruthy();
    const input = screen.getByLabelText('PIN do passageiro');
    await fireEvent.changeText(input, '12a');
    expect(input.props.value).toBe('12');
    await fireEvent.press(screen.getByText('Confirmar embarque'));
    expect(advance).not.toHaveBeenCalled();
    await fireEvent.changeText(input, '48215');
    expect(input.props.value).toBe('4821');
    await fireEvent.press(screen.getByText('Confirmar embarque'));
    expect(advance).toHaveBeenCalledWith('4821');
  });

  it('só pede PIN no embarque; nas outras etapas avança direto', async () => {
    const advance = jest.fn(async () => undefined);
    await renderRide('ACEITO', { advance });
    expect(screen.queryByText('PIN de embarque')).toBeNull();
    await fireEvent.press(screen.getByText('Ir buscar o passageiro'));
    expect(advance).toHaveBeenCalledWith();
  });

  it('entrega comum nunca pede PIN', async () => {
    await render(
      <WithDriver
        value={driverValue({ online: true, active: { ...active, status: 'A_CAMINHO_COLETA' } })}
      >
        <ActiveDeliveryScreen />
      </WithDriver>,
    );
    expect(screen.queryByText('PIN de embarque')).toBeNull();
    expect(screen.getByText('Confirmar coleta')).toBeTruthy();
    expect(screen.queryByText('Denunciar')).toBeNull();
  });

  it('PIN errado vem do servidor e aparece na tela', async () => {
    await renderRide('A_CAMINHO_COLETA', {
      actionError: 'PIN de embarque incorreto. Peça o PIN ao passageiro.',
    });
    expect(screen.getByText('PIN de embarque incorreto. Peça o PIN ao passageiro.')).toBeTruthy();
  });

  it('emergência avisa a associação com o id da corrida; denúncia vai ligada à corrida', async () => {
    mockApi.mockResolvedValue({ id: 'x' });
    await renderRide('COLETADO');
    await fireEvent.press(screen.getByText('🚨 Emergência'));
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Só avisar a associação')!.onPress!();
    });
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/safety/emergency', {
        body: { deliveryId: 'd1', lat: -7.115, lng: -34.861 },
      }),
    );
    await fireEvent.press(screen.getByText('Denunciar'));
    await fireEvent.press(screen.getByText('Assédio'));
    await fireEvent.changeText(screen.getByLabelText('O que aconteceu?'), 'Passageiro me ofendeu.');
    await fireEvent.press(screen.getByText('Enviar denúncia'));
    await screen.findByText('Denúncia enviada');
    expect(mockApi).toHaveBeenCalledWith('/safety/reports', {
      body: { deliveryId: 'd1', category: 'ASSEDIO', description: 'Passageiro me ofendeu.' },
    });
  });

  it('etapas de corrida no indicador de progresso', async () => {
    await render(<StepProgress done={1} kind="CORRIDA" />);
    expect(screen.getByText('Buscando o passageiro')).toBeTruthy();
    expect(screen.getByText('A bordo')).toBeTruthy();
    expect(screen.getByText('Concluída')).toBeTruthy();
  });
});

describe('depois da corrida', () => {
  it('o motorista é convidado a avaliar o passageiro e envia a nota', async () => {
    mockApi.mockResolvedValue({});
    const dismissCompleted = jest.fn();
    await render(
      <WithDriver
        value={driverValue({
          completed: { fareCents: 1500, workerNetCents: 1350, rideId: 'r1' },
          dismissCompleted,
        })}
      >
        <DriverHome />
      </WithDriver>,
    );
    expect(screen.getByText('Corrida concluída ✓')).toBeTruthy();
    expect(screen.getByText('Como foi o passageiro?')).toBeTruthy();
    expect(screen.getByText(/nunca a sua nota nem o texto/)).toBeTruthy();
    expect(
      screen.getByText('Enviar avaliação').props.accessibilityState?.disabled ?? true,
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('star-4'));
    await fireEvent.press(screen.getByText('Enviar avaliação'));
    await waitFor(() => expect(dismissCompleted).toHaveBeenCalled());
    expect(mockApi).toHaveBeenCalledWith('/driver/deliveries/r1/rating', {
      body: { stars: 4, comment: undefined },
    });
  });

  it('"Agora não" dispensa sem avaliar; entrega concluída não pede avaliação', async () => {
    const dismissCompleted = jest.fn();
    const { unmount } = await render(
      <WithDriver
        value={driverValue({
          completed: { fareCents: 1500, workerNetCents: 1350, rideId: 'r1' },
          dismissCompleted,
        })}
      >
        <DriverHome />
      </WithDriver>,
    );
    await fireEvent.press(screen.getByText('Agora não'));
    expect(dismissCompleted).toHaveBeenCalled();
    expect(mockApi).not.toHaveBeenCalled();
    unmount();
    await render(
      <WithDriver value={driverValue({ completed: { fareCents: 1100, workerNetCents: 968 } })}>
        <DriverHome />
      </WithDriver>,
    );
    expect(screen.getByText('Entrega concluída ✓')).toBeTruthy();
    expect(screen.queryByText('Como foi o passageiro?')).toBeNull();
  });
});
