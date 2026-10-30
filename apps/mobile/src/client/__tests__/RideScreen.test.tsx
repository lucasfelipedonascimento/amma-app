import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { ApiError, api } from '../../api';
import { RideScreen } from '../screens/RideScreen';
import { clientValue, delivery, WithClient } from '../../testing/clientFixtures';
import type { ClientValue } from '../ClientProvider';
import type { RideQuote, RideRules } from '../types';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn() };
});
const mockApi = api as jest.Mock;

const rules: RideRules = {
  city: 'João Pessoa - PB',
  womenDriverOptionEnabled: true,
  vehicleTypes: [
    { type: 'CARRO', label: 'Carro', enabled: true, notices: [] },
    { type: 'MOTO', label: 'Moto', enabled: true, notices: ['Capacete obrigatório'] },
  ],
};

const quote: RideQuote = {
  distanceMeters: 2894,
  durationSeconds: 417,
  womenDriverOnly: false,
  options: [
    {
      vehicleType: 'CARRO',
      label: 'Carro',
      available: true,
      fareCents: 1500,
      minimumApplied: true,
      driversNearby: 2,
      pickupEtaSeconds: 180,
      notices: [],
    },
    {
      vehicleType: 'MOTO',
      label: 'Moto',
      available: true,
      fareCents: 1000,
      minimumApplied: false,
      driversNearby: 0,
      pickupEtaSeconds: null,
      notices: ['Capacete obrigatório'],
    },
  ],
};

const setup = async (over: Partial<ClientValue> = {}) => {
  const onOpen = jest.fn();
  await render(
    <WithClient value={clientValue(over)}>
      <RideScreen onOpen={onOpen} />
    </WithClient>,
  );
  return { onOpen };
};

const fill = async () => {
  await fireEvent.changeText(screen.getByLabelText('De onde você sai'), 'Rua da Coleta, 100');
  await fireEvent.changeText(screen.getByLabelText('Para onde você vai'), 'Rua da Entrega, 200');
};

let rulesResponse: RideRules;
let ridesResponse: unknown[];
beforeEach(() => {
  (Location.geocodeAsync as jest.Mock).mockClear();
  rulesResponse = rules;
  ridesResponse = [];
  mockApi.mockReset();
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/rides/rules') return rulesResponse;
    if (path.startsWith('/rides?')) return ridesResponse;
    if (path === '/rides/quote') return quote;
    if (path === '/rides') return { id: 'corrida-1' };
    if (path === '/payments/sandbox/card-tokens') return { token: 'sbx_ok_4242_visa' };
    throw new ApiError(404, path);
  });
});

describe('Pedir corrida', () => {
  it('exige origem e destino antes de cotar', async () => {
    await setup();
    await fireEvent.press(await screen.findByText('Ver preços e tempo'));
    expect(screen.getByText('Informe de onde você sai e para onde vai.')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalledWith('/rides/quote', expect.anything());
  });

  it('mostra preço e tempo de cada tipo de veículo ANTES de cobrar', async () => {
    await setup();
    await screen.findByText('Prefiro motorista mulher');
    await fill();
    await fireEvent.press(screen.getByText('Ver preços e tempo'));
    await screen.findByText('Escolha sua corrida');
    expect(screen.getAllByText(/R\$\s15,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R\$\s10,00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Motorista chega em 3 min/)).toBeTruthy();
    expect(screen.getByText(/Nenhum motorista por perto agora/)).toBeTruthy();
    expect(screen.getByText('Tempo de viagem')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalledWith('/rides', expect.anything());
  });

  it('confirma o tipo escolhido enviando o preço visto, a chave e o Pix', async () => {
    const { onOpen } = await setup();
    await screen.findByText('Prefiro motorista mulher');
    await fill();
    await fireEvent.press(screen.getByText('Ver preços e tempo'));
    await screen.findByText('Escolha sua corrida');
    await fireEvent.press(screen.getByTestId('option-MOTO'));
    expect(screen.getByText(/Capacete obrigatório/)).toBeTruthy();
    await fireEvent.press(screen.getByText(/Pedir moto/));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('corrida-1'));
    const call = mockApi.mock.calls.find((c) => c[0] === '/rides')!;
    expect(call[1].body).toMatchObject({
      vehicleType: 'MOTO',
      womenDriverOnly: false,
      expectedFareCents: 1000,
      payment: { method: 'PIX' },
      pickup: { address: 'Rua da Coleta, 100' },
      dropoff: { address: 'Rua da Entrega, 200' },
    });
    expect(call[1].body.idempotencyKey).toMatch(/^[\w-]{8,64}$/);
  });

  it('motorista mulher vai na cotação e no pedido', async () => {
    await setup();
    await fireEvent(await screen.findByLabelText('Prefiro motorista mulher'), 'valueChange', true);
    await fill();
    await fireEvent.press(screen.getByText('Ver preços e tempo'));
    await screen.findByText('Escolha sua corrida');
    expect(mockApi.mock.calls.find((c) => c[0] === '/rides/quote')![1].body.womenDriverOnly).toBe(
      true,
    );
    await fireEvent.press(screen.getByText(/Pedir carro/));
    await waitFor(() => expect(mockApi.mock.calls.some((c) => c[0] === '/rides')).toBe(true));
    expect(mockApi.mock.calls.find((c) => c[0] === '/rides')![1].body.womenDriverOnly).toBe(true);
  });

  it('a opção de motorista mulher some se a configuração a desligar', async () => {
    rulesResponse = { ...rules, womenDriverOptionEnabled: false };
    await setup();
    await screen.findByText('Ver preços e tempo');
    expect(screen.queryByText('Prefiro motorista mulher')).toBeNull();
  });

  it('tipo sem tabela de preço fica desabilitado', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/rides/rules') return rules;
      if (path.startsWith('/rides?')) return [];
      if (path === '/rides/quote')
        return {
          ...quote,
          options: [{ ...quote.options[0], available: false, fareCents: null }, quote.options[1]],
        };
      throw new ApiError(404, path);
    });
    await setup();
    await screen.findByText('Ver preços e tempo');
    await fill();
    await fireEvent.press(screen.getByText('Ver preços e tempo'));
    await screen.findByText('Escolha sua corrida');
    expect(screen.getByText('Indisponível no momento')).toBeTruthy();
    expect(screen.getByText(/Pedir moto/)).toBeTruthy(); // a moto, disponível, vem escolhida
  });

  it('nenhum tipo liberado: avisa em vez de mostrar o formulário', async () => {
    rulesResponse = {
      ...rules,
      vehicleTypes: rules.vehicleTypes.map((v) => ({ ...v, enabled: false })),
    };
    await setup();
    expect(await screen.findByText(/ainda não estão liberadas em João Pessoa - PB/)).toBeTruthy();
    expect(screen.queryByText('Ver preços e tempo')).toBeNull();
  });

  it('preço mudou no meio do caminho (409): mostra o erro e não abre a corrida', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/rides/rules') return rules;
      if (path.startsWith('/rides?')) return [];
      if (path === '/rides/quote') return quote;
      if (path === '/rides')
        throw new ApiError(409, 'O preço mudou. Confira o novo valor antes de confirmar.');
      throw new ApiError(404, path);
    });
    const { onOpen } = await setup();
    await screen.findByText('Ver preços e tempo');
    await fill();
    await fireEvent.press(screen.getByText('Ver preços e tempo'));
    await screen.findByText('Escolha sua corrida');
    await fireEvent.press(screen.getByText(/Pedir carro/));
    expect(await screen.findByText(/O preço mudou/)).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('mostra a corrida em andamento e as recentes para reabrir', async () => {
    ridesResponse = [
      { ...delivery, id: 'r-aberta', kind: 'CORRIDA', status: 'A_CAMINHO_COLETA' },
      { ...delivery, id: 'r-antiga', kind: 'CORRIDA', status: 'ENTREGUE' },
    ];
    const { onOpen } = await setup();
    await fireEvent.press(await screen.findByTestId('delivery-r-aberta'));
    expect(onOpen).toHaveBeenCalledWith('r-aberta');
    expect(screen.getByText('Corridas recentes')).toBeTruthy();
    expect(screen.getByTestId('delivery-r-antiga')).toBeTruthy();
  });
});
