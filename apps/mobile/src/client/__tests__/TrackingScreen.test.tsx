import { Alert, Share } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiError, api } from '../../api';
import { TrackingScreen } from '../screens/TrackingScreen';
import {
  clientValue,
  delivery,
  payment,
  pixPayment,
  WithClient,
} from '../../testing/clientFixtures';
import type { ClientValue } from '../ClientProvider';
import type { ClientDelivery } from '../types';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn() };
});
const mockApi = api as jest.Mock;

let current: ClientDelivery;
let listener: ((event: string, data: unknown) => void) | null;

const setup = async (d: ClientDelivery, over: Partial<ClientValue> = {}) => {
  current = d;
  listener = null;
  mockApi.mockImplementation(async (path: string, opts?: { body?: unknown }) => {
    if (path === `/deliveries/${d.id}`) return current;
    if (path.endsWith('/cancel')) {
      current = {
        ...current,
        status: 'CANCELADO',
        cancelReason: 'CLIENTE_DESISTIU',
        payment: { ...payment, status: 'ESTORNADO', refundedAt: 'x' },
      };
      return current;
    }
    if (path.includes('/sandbox/pix/')) {
      current = { ...current, payment, status: 'OFERECIDO' };
      return { status: 'PAGO' };
    }
    if (path.endsWith('/rating')) {
      const b = opts!.body as { stars: number; comment?: string };
      current = { ...current, rating: { stars: b.stars, comment: b.comment ?? null, at: 'x' } };
      return current;
    }
    throw new ApiError(404, path);
  });
  const props = { id: d.id, onBack: jest.fn(), onReceipt: jest.fn() };
  await render(
    <WithClient
      value={clientValue({
        subscribe: (fn) => {
          listener = fn;
          return () => {};
        },
        ...over,
      })}
    >
      <TrackingScreen {...props} />
    </WithClient>,
  );
  return props;
};

beforeEach(() => mockApi.mockReset());

describe('Acompanhar entrega', () => {
  it('em busca de motorista: mostra estado, etapas, pagamento e permite cancelar', async () => {
    await setup(delivery);
    expect(await screen.findByText('Buscando motorista')).toBeTruthy();
    expect(screen.getByTestId('stage-0')).toBeTruthy();
    expect(screen.getByTestId('payment-status').props.children).toBe('Pago');
    expect(screen.getByText('Cancelar pedido')).toBeTruthy();
    expect(screen.queryByText('Enviar avaliação')).toBeNull();
  });

  it('mostra o motorista no mapa em tempo real, só com a posição do próprio pedido', async () => {
    await setup({ ...delivery, status: 'A_CAMINHO_COLETA', driver: { id: 'm1', name: 'Maria' } });
    await screen.findByText('Motorista indo à coleta');
    expect(screen.getByText('Maria')).toBeTruthy();
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
    await act(async () =>
      listener!('driver.position', { deliveryId: 'outro', lat: -7.1, lng: -34.8 }),
    );
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
    await act(async () =>
      listener!('driver.position', { deliveryId: 'd1', lat: -7.1, lng: -34.8 }),
    );
    expect(screen.getAllByTestId('marker')).toHaveLength(3);
  });

  it('evento delivery.updated recarrega o pedido', async () => {
    await setup(delivery);
    await screen.findByText('Buscando motorista');
    current = { ...current, status: 'COLETADO' };
    await act(async () => listener!('delivery.updated', { id: 'd1', status: 'COLETADO' }));
    expect(await screen.findByText('Item coletado')).toBeTruthy();
    // Sem cancelar depois de coletado.
    expect(screen.queryByText('Cancelar pedido')).toBeNull();
  });

  it('Pix pendente: mostra o código e, ao simular o pagamento, segue para a busca', async () => {
    await setup({ ...delivery, status: 'CRIADO', payment: pixPayment });
    expect(await screen.findByText('Aguardando o pagamento')).toBeTruthy();
    expect(screen.getByTestId('pix-code').props.children).toBe(pixPayment.pixCode);
    expect(screen.getByTestId('pix-timer').props.children).toMatch(/Vence em \d\d:\d\d/);
    await fireEvent.press(screen.getByText('Simular pagamento do Pix'));
    await waitFor(() => expect(screen.getByTestId('payment-status').props.children).toBe('Pago'));
    expect(screen.queryByTestId('pix-code')).toBeNull();
  });

  it('Pix: compartilha o código; fora do sandbox não há botão de simular', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await setup({ ...delivery, status: 'CRIADO', payment: { ...pixPayment, sandbox: false } });
    await screen.findByTestId('pix-code');
    expect(screen.queryByText('Simular pagamento do Pix')).toBeNull();
    await fireEvent.press(screen.getByText('Compartilhar código Pix'));
    expect(share).toHaveBeenCalledWith({ message: pixPayment.pixCode });
  });

  it('cancelar pago avisa do estorno e mostra o dinheiro devolvido', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      void buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await setup(delivery);
    await screen.findByText('Buscando motorista');
    await fireEvent.press(screen.getByText('Cancelar pedido'));
    expect(alert.mock.calls[0]![1]).toMatch(/estorno/);
    expect(await screen.findByText('Cancelado')).toBeTruthy();
    expect(screen.getByText('Você cancelou o pedido.')).toBeTruthy();
    expect(screen.getByTestId('payment-status').props.children).toBe('Estornado');
    expect(screen.getByText('Ver recibo')).toBeTruthy();
    const call = mockApi.mock.calls.find((c) => String(c[0]).endsWith('/cancel'))!;
    expect(call[1].body).toEqual({ reason: 'CLIENTE_DESISTIU' });
  });

  it('entregue: avalia (nota obrigatória) e vê a própria avaliação depois', async () => {
    await setup({ ...delivery, status: 'ENTREGUE', driver: { id: 'm1', name: 'Maria' } });
    await screen.findByText('Como foi a entrega?');
    const send = screen.getByText('Enviar avaliação');
    await fireEvent.press(send);
    expect(mockApi.mock.calls.some((c) => String(c[0]).endsWith('/rating'))).toBe(false);
    await fireEvent.press(screen.getByLabelText('4 estrelas'));
    await fireEvent.changeText(screen.getByLabelText('Comentário (opcional)'), ' Chegou rápido ');
    await fireEvent.press(screen.getByText('Enviar avaliação'));
    expect(await screen.findByText('Sua avaliação')).toBeTruthy();
    expect(screen.getByText('Chegou rápido')).toBeTruthy();
    const body = mockApi.mock.calls.find((c) => String(c[0]).endsWith('/rating'))![1].body;
    expect(body).toEqual({ stars: 4, comment: 'Chegou rápido' });
  });

  it('abre o recibo quando há pagamento confirmado', async () => {
    const props = await setup({ ...delivery, status: 'ENTREGUE' });
    await fireEvent.press(await screen.findByText('Ver recibo'));
    expect(props.onReceipt).toHaveBeenCalled();
  });

  it('pedido sem pagamento confirmado não oferece recibo', async () => {
    await setup({ ...delivery, status: 'CRIADO', payment: pixPayment });
    await screen.findByText('Aguardando o pagamento');
    expect(screen.queryByText('Ver recibo')).toBeNull();
  });

  it('Pix vencido: explica o motivo do cancelamento', async () => {
    await setup({
      ...delivery,
      status: 'CANCELADO',
      cancelReason: 'PAGAMENTO_NAO_CONFIRMADO',
      payment: { ...pixPayment, status: 'EXPIRADO', pixCode: null },
    });
    expect(await screen.findByText('O Pix não foi pago a tempo.')).toBeTruthy();
    expect(screen.queryByText('Cancelar pedido')).toBeNull();
  });

  it('erro ao carregar: tela de erro com nova tentativa', async () => {
    mockApi.mockRejectedValue(new ApiError(0, 'Sem conexão com o servidor.'));
    await render(
      <WithClient value={clientValue()}>
        <TrackingScreen id="d1" onBack={jest.fn()} onReceipt={jest.fn()} />
      </WithClient>,
    );
    expect(await screen.findByText('Sem conexão com o servidor.')).toBeTruthy();
    expect(screen.getByText('Tentar de novo')).toBeTruthy();
  });
});
