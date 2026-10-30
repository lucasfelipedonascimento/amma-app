import { Alert, Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ActiveDeliveryScreen } from '../screens/ActiveDeliveryScreen';
import { active, driverValue, WithDriver } from '../../testing/fixtures';
import type { ActiveDelivery } from '../types';

const mockRoute = jest.fn();
jest.mock('../useRouteInfo', () => ({ useRouteInfo: (...a: unknown[]) => mockRoute(...a) }));

const route = {
  target: 'COLETA' as const,
  destination: active.pickup,
  distanceMeters: 1500,
  durationSeconds: 300,
  path: [
    { lat: -7.12, lng: -34.86 },
    { lat: -7.115, lng: -34.861 },
  ],
};

const renderScreen = (status: ActiveDelivery['status'], over = {}) =>
  render(
    <WithDriver value={driverValue({ online: true, active: { ...active, status }, ...over })}>
      <ActiveDeliveryScreen />
    </WithDriver>,
  );

beforeEach(() => {
  mockRoute.mockReturnValue({ route, error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Entrega em andamento', () => {
  it('mostra o mapa com a rota, os marcadores e o endereço do destino', async () => {
    await renderScreen('ACEITO', { position: { lat: -7.12, lng: -34.86 } });
    expect(screen.getByTestId('map')).toBeTruthy();
    expect(screen.getByTestId('polyline')).toBeTruthy();
    expect(screen.getAllByTestId('marker')).toHaveLength(3); // coleta, entrega e motorista
    expect(screen.getByTestId('target-address').props.children).toBe('Rua da Coleta, 100');
    expect(screen.getByText('Ir buscar em')).toBeTruthy();
    expect(screen.getByText(/1,5 km · 5 min/)).toBeTruthy();
  });

  it.each([
    ['ACEITO', 'Ir para a coleta'],
    ['A_CAMINHO_COLETA', 'Confirmar coleta'],
    ['COLETADO', 'Seguir para a entrega'],
    ['A_CAMINHO_ENTREGA', 'Confirmar entrega'],
  ] as const)('em %s o botão principal é "%s" e avança a etapa', async (status, label) => {
    const advance = jest.fn(async () => undefined);
    await renderScreen(status, { advance });
    await fireEvent.press(screen.getByText(label));
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('longe do destino avisa a distância e não deixa concluir', async () => {
    const advance = jest.fn(async () => undefined);
    await renderScreen('A_CAMINHO_ENTREGA', {
      advance,
      position: { lat: -7.115, lng: -34.861 }, // ~2,2 km do destino
    });
    expect(screen.getByText(/Chegue a até 300 m para concluir/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirmar entrega'));
    expect(advance).not.toHaveBeenCalled();
  });

  it.each([
    ['perto do destino', { lat: -7.0951, lng: -34.861 }], // ~11 m
    ['sem posição (o servidor decide)', null],
  ])('%s deixa concluir', async (_n, position) => {
    const advance = jest.fn(async () => undefined);
    await renderScreen('A_CAMINHO_ENTREGA', { advance, position });
    expect(screen.queryByText(/Chegue a até/)).toBeNull();
    await fireEvent.press(screen.getByText('Confirmar entrega'));
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('depois de coletar o destino é a entrega', async () => {
    mockRoute.mockReturnValue({
      route: { ...route, target: 'ENTREGA', destination: active.dropoff },
      error: null,
    });
    await renderScreen('A_CAMINHO_ENTREGA');
    expect(screen.getByText('Levar até')).toBeTruthy();
    expect(screen.getByTestId('target-address').props.children).toBe('Rua da Entrega, 200');
  });

  it('até a coleta dá para liberar o pedido (com confirmação); depois não', async () => {
    const release = jest.fn(async () => undefined);
    await renderScreen('A_CAMINHO_COLETA', { release });
    await fireEvent.press(screen.getByText('Não consigo seguir'));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled(); // só depois de confirmar
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    buttons.find((b) => b.text === 'Liberar pedido')!.onPress!();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('depois de coletar não existe "Não consigo seguir"', async () => {
    await renderScreen('COLETADO');
    expect(screen.queryByText('Não consigo seguir')).toBeNull();
  });

  it('botão de emergência pede confirmação e oferece 190, 192 e 193', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await renderScreen('ACEITO');
    await fireEvent.press(screen.getByText('🚨 Emergência'));
    const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0] as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];
    expect(title).toBe('Emergência');
    expect(buttons.map((b) => b.text)).toEqual(
      expect.arrayContaining(['Polícia — 190', 'SAMU — 192', 'Bombeiros — 193', 'Cancelar']),
    );
    expect(open).not.toHaveBeenCalled();
    buttons.find((b) => b.text.includes('190'))!.onPress!();
    expect(open).toHaveBeenCalledWith('tel:190');
  });

  it('rota indisponível: avisa, mas mantém mapa e botões', async () => {
    mockRoute.mockReturnValue({ route: null, error: 'Não foi possível traçar a rota agora' });
    await renderScreen('ACEITO');
    expect(screen.getByText(/Rota indisponível agora/)).toBeTruthy();
    expect(screen.getByText('Ir para a coleta')).toBeTruthy();
    expect(screen.queryByTestId('polyline')).toBeNull();
  });

  it('sem internet: faixa de aviso e etapa bloqueada', async () => {
    await renderScreen('ACEITO', { offline: true });
    expect(screen.getByText(/Sem internet/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Ir para a coleta' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it('erro ao avançar etapa aparece na tela', async () => {
    await renderScreen('ACEITO', { actionError: 'Esta etapa já foi concluída' });
    expect(screen.getByText('Esta etapa já foi concluída')).toBeTruthy();
  });

  it('abre o app de mapas com o destino', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await renderScreen('ACEITO');
    await fireEvent.press(screen.getByText('Abrir no app de mapas'));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('destination=-7.115,-34.861'));
  });
});
