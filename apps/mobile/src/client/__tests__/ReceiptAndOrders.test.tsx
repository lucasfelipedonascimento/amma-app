import { Share } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Receipt } from '@amma/shared';
import { ApiError, api } from '../../api';
import { OrdersScreen } from '../screens/OrdersScreen';
import { ReceiptScreen } from '../screens/ReceiptScreen';
import { clientValue, delivery, payment, WithClient } from '../../testing/clientFixtures';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn() };
});
const mockApi = api as jest.Mock;

const receipt: Receipt = {
  deliveryId: 'd1',
  number: 'AMMA-20261029-1A2B3C4D',
  createdAt: '2026-10-29T18:00:00Z',
  deliveredAt: null,
  status: 'ENTREGUE',
  pickupAddress: 'Rua A, 1',
  dropoffAddress: 'Rua B, 2',
  distanceMeters: 3000,
  durationSeconds: 600,
  fareCents: 1100,
  minimumApplied: true,
  pricingVersion: 'v1',
  payment: { ...payment, paidAt: null, refundedAt: null },
  paidCents: 1100,
  refundedCents: 0,
  notice: 'Comprovante de pagamento da entrega. Não é nota fiscal.',
};

describe('Recibo', () => {
  beforeEach(() => mockApi.mockReset());

  it('mostra número, valores e o aviso de que não é nota fiscal; compartilha', async () => {
    mockApi.mockResolvedValue(receipt);
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await render(<ReceiptScreen id="d1" onBack={jest.fn()} />);
    expect(await screen.findByTestId('receipt-number')).toBeTruthy();
    expect(screen.getByText('Cartão visa final 4242')).toBeTruthy();
    expect(screen.getByText('Total pago')).toBeTruthy();
    expect(screen.getByText(/Não é nota fiscal/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Compartilhar recibo'));
    expect(share.mock.calls[0]![0]!.message).toContain('AMMA-20261029-1A2B3C4D');
  });

  it('estornado: mostra o valor devolvido no lugar de "Total pago"', async () => {
    mockApi.mockResolvedValue({
      ...receipt,
      payment: { ...receipt.payment!, status: 'ESTORNADO' },
      paidCents: 0,
      refundedCents: 1100,
    });
    await render(<ReceiptScreen id="d1" onBack={jest.fn()} />);
    // "Estornado" aparece na situação do pagamento e na linha do valor devolvido.
    expect(await screen.findAllByText('Estornado')).toHaveLength(2);
    expect(screen.queryByText('Total pago')).toBeNull();
  });

  it('recibo indisponível (409): mostra o motivo', async () => {
    mockApi.mockRejectedValue(
      new ApiError(409, 'O recibo fica disponível depois que o pagamento é confirmado'),
    );
    await render(<ReceiptScreen id="d1" onBack={jest.fn()} />);
    expect(await screen.findByText(/disponível depois/)).toBeTruthy();
  });
});

describe('Histórico', () => {
  const done = { ...delivery, id: 'd2', status: 'ENTREGUE' as const };
  const cancelled = {
    ...delivery,
    id: 'd3',
    status: 'CANCELADO' as const,
    payment: { ...payment, status: 'ESTORNADO' as const },
  };

  it('separa em andamento e anteriores, com a situação do pagamento', async () => {
    const onOpen = jest.fn();
    await render(
      <WithClient value={clientValue({ deliveries: [delivery, done, cancelled] })}>
        <OrdersScreen onOpen={onOpen} />
      </WithClient>,
    );
    expect(screen.getByText('Em andamento')).toBeTruthy();
    expect(screen.getByText('Anteriores')).toBeTruthy();
    expect(screen.getByText('Cancelado · Estornado')).toBeTruthy();
    expect(screen.getByText('Entregue · Pago')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('delivery-d2'));
    expect(onOpen).toHaveBeenCalledWith('d2');
  });

  it('vazio, carregando e erro', async () => {
    const view = await render(
      <WithClient value={clientValue({ deliveries: [] })}>
        <OrdersScreen onOpen={jest.fn()} />
      </WithClient>,
    );
    expect(screen.getByText('Você ainda não fez nenhum pedido.')).toBeTruthy();
    await view.unmount();
    const reload = jest.fn(async () => undefined);
    await render(
      <WithClient
        value={clientValue({
          deliveries: null,
          deliveriesError: 'Sem conexão.',
          reloadDeliveries: reload,
        })}
      >
        <OrdersScreen onOpen={jest.fn()} />
      </WithClient>,
    );
    await fireEvent.press(screen.getByText('Tentar de novo'));
    expect(reload).toHaveBeenCalled();
  });
});
