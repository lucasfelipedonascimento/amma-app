import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { ApiError, api } from '../../api';
import { NewDeliveryScreen } from '../screens/NewDeliveryScreen';
import { clientValue, WithClient } from '../../testing/clientFixtures';
import { plain } from '../../testing/fixtures';
import type { ClientValue } from '../ClientProvider';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn() };
});
const mockApi = api as jest.Mock;

const quote = {
  distanceMeters: 2894,
  durationSeconds: 417,
  fareCents: 1100,
  minimumApplied: true,
  pricingVersion: 'v1',
};

const setup = async (over: Partial<ClientValue> = {}) => {
  const onCreated = jest.fn();
  const onOpenStore = jest.fn();
  await render(
    <WithClient value={clientValue(over)}>
      <NewDeliveryScreen onCreated={onCreated} onOpenStore={onOpenStore} />
    </WithClient>,
  );
  return { onCreated, onOpenStore };
};

async function fill(
  pickup = 'Rua da Coleta, 100',
  dropoff = 'Rua da Entrega, 200',
  notes = 'Marmita',
) {
  await fireEvent.changeText(screen.getByLabelText('Onde coletar'), pickup);
  await fireEvent.changeText(screen.getByLabelText('Para onde entregar'), dropoff);
  await fireEvent.changeText(screen.getByLabelText('O que vai ser entregue?'), notes);
}

beforeEach(() => {
  (Location.geocodeAsync as jest.Mock).mockClear();
  mockApi.mockReset();
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/deliveries/quote') return quote;
    if (path === '/deliveries') return { id: 'novo-1' };
    if (path === '/payments/sandbox/card-tokens') return { token: 'sbx_ok_4242_visa' };
    throw new ApiError(404, path);
  });
});

describe('Pedir entrega', () => {
  it('exige origem, destino e descrição antes de cotar', async () => {
    await setup();
    await fireEvent.press(screen.getByText('Ver preço'));
    expect(screen.getByText('Informe o endereço de coleta e o de entrega.')).toBeTruthy();
    await fill('Rua A, 1', 'Rua B, 2', '');
    await fireEvent.press(screen.getByText('Ver preço'));
    expect(screen.getByText('Descreva o que vai ser entregue.')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('mostra o preço ANTES de qualquer cobrança', async () => {
    await setup();
    await fill();
    await fireEvent.press(screen.getByText('Ver preço'));
    await waitFor(() => expect(screen.getByTestId('quote-total')).toBeTruthy());
    expect(plain(screen.getByTestId('quote-total').props.children)).toBe('R$ 11,00');
    expect(screen.getByText('Valor mínimo da entrega aplicado.')).toBeTruthy();
    expect(screen.getByTestId('map')).toBeTruthy();
    expect(mockApi.mock.calls.map((c) => c[0])).toEqual(['/deliveries/quote']);
  });

  it('endereço que não existe: avisa qual e não cota', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValueOnce([]);
    await setup();
    await fill();
    await fireEvent.press(screen.getByText('Ver preço'));
    expect(await screen.findByText(/endereço de coleta/)).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('Pix: confirma com a chave de idempotência e o preço que o cliente viu', async () => {
    const { onCreated } = await setup();
    await fill();
    await fireEvent.press(screen.getByText('Ver preço'));
    await screen.findByTestId('quote-total');
    await fireEvent.press(screen.getByText(/Confirmar e pagar/));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('novo-1'));
    const [, opts] = mockApi.mock.calls.find((c) => c[0] === '/deliveries')!;
    expect(opts.body).toMatchObject({
      payment: { method: 'PIX' },
      expectedFareCents: 1100,
      notes: 'Marmita',
      pickup: { address: 'Rua da Coleta, 100' },
      dropoff: { address: 'Rua da Entrega, 200' },
    });
    expect(opts.body.idempotencyKey).toMatch(/^[\w-]{8,64}$/);
  });

  it('cartão inválido não chega ao servidor', async () => {
    await setup();
    await fill();
    await fireEvent.press(screen.getByText('Ver preço'));
    await screen.findByTestId('quote-total');
    await fireEvent.press(screen.getByText('Cartão'));
    await fireEvent.changeText(screen.getByLabelText('Número do cartão'), '4242424242424241');
    await fireEvent.press(screen.getByText(/Confirmar e pagar/));
    expect(await screen.findByText('Confira o número do cartão.')).toBeTruthy();
    expect(mockApi.mock.calls.map((c) => c[0])).toEqual(['/deliveries/quote']);
  });

  it('cartão: troca os dados por token e manda só o token', async () => {
    const { onCreated } = await setup();
    await fill();
    await fireEvent.press(screen.getByText('Ver preço'));
    await screen.findByTestId('quote-total');
    await fireEvent.press(screen.getByText('Cartão'));
    await fireEvent.changeText(screen.getByLabelText('Número do cartão'), '4242424242424242');
    await fireEvent.changeText(screen.getByLabelText('Validade'), '1299');
    await fireEvent.changeText(screen.getByLabelText('Código (CVV)'), '123');
    await fireEvent.press(screen.getByText(/Confirmar e pagar/));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const created = mockApi.mock.calls.find((c) => c[0] === '/deliveries')![1].body;
    expect(created.payment).toEqual({ method: 'CARTAO', cardToken: 'sbx_ok_4242_visa' });
    expect(JSON.stringify(created)).not.toContain('4242424242424242');
  });

  it('cartão recusado: mostra o motivo e continua na confirmação', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/deliveries/quote') return quote;
      if (path === '/payments/sandbox/card-tokens') return { token: 'sbx_declined_0002_visa' };
      throw new ApiError(402, 'Cartão recusado pelo banco');
    });
    const { onCreated } = await setup();
    await fill();
    await fireEvent.press(screen.getByText('Ver preço'));
    await screen.findByTestId('quote-total');
    await fireEvent.press(screen.getByText('Cartão'));
    await fireEvent.changeText(screen.getByLabelText('Número do cartão'), '4000000000000002');
    await fireEvent.changeText(screen.getByLabelText('Validade'), '1299');
    await fireEvent.changeText(screen.getByLabelText('Código (CVV)'), '123');
    await fireEvent.press(screen.getByText(/Confirmar e pagar/));
    expect(await screen.findByText('Cartão recusado pelo banco')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByTestId('quote-total')).toBeTruthy();
  });

  it('sem provedor de testes, cartão fica indisponível (o Pix segue)', async () => {
    await setup({ paymentConfig: { provider: 'x', sandbox: false, methods: ['PIX', 'CARTAO'] } });
    await fill();
    await fireEvent.press(screen.getByText('Ver preço'));
    await screen.findByTestId('quote-total');
    await fireEvent.press(screen.getByText('Cartão'));
    await fireEvent.changeText(screen.getByLabelText('Número do cartão'), '4242424242424242');
    await fireEvent.changeText(screen.getByLabelText('Validade'), '1299');
    await fireEvent.changeText(screen.getByLabelText('Código (CVV)'), '123');
    await fireEvent.press(screen.getByText(/Confirmar e pagar/));
    expect(await screen.findByText(/Cartão indisponível|cartão indisponível/i)).toBeTruthy();
  });

  it('comerciante: a coleta já vem com o endereço do estabelecimento (sem geocodificar de novo)', async () => {
    await setup({
      isMerchant: true,
      merchant: {
        tradeName: 'Padaria',
        cnpj: null,
        address: 'Av. Central, 5',
        lat: -7.2,
        lng: -34.9,
      },
    });
    expect(screen.getByLabelText('Onde coletar').props.value).toBe('Av. Central, 5');
    await fireEvent.changeText(screen.getByLabelText('Para onde entregar'), 'Rua B, 2');
    await fireEvent.changeText(screen.getByLabelText('O que vai ser entregue?'), 'Bolo');
    await fireEvent.press(screen.getByText('Ver preço'));
    await screen.findByTestId('quote-total');
    const quoteBody = mockApi.mock.calls[0]![1].body;
    expect(quoteBody.pickup).toEqual({ lat: -7.2, lng: -34.9, address: 'Av. Central, 5' });
    expect(Location.geocodeAsync).toHaveBeenCalledTimes(1); // só o destino
  });

  it('comerciante sem cadastro é levado a cadastrar o estabelecimento', async () => {
    const { onOpenStore } = await setup({ isMerchant: true, merchant: null });
    await fireEvent.press(screen.getByText('Cadastrar estabelecimento'));
    expect(onOpenStore).toHaveBeenCalled();
  });

  it('preço mudou no servidor (409): mostra a mensagem', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/deliveries/quote') return quote;
      throw new ApiError(409, 'O preço mudou. Confira o novo valor antes de confirmar.');
    });
    await setup();
    await fill();
    await fireEvent.press(screen.getByText('Ver preço'));
    await screen.findByTestId('quote-total');
    await fireEvent.press(screen.getByText(/Confirmar e pagar/));
    expect(await screen.findByText(/O preço mudou/)).toBeTruthy();
  });
});
