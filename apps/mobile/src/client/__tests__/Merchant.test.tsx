import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import type { MerchantReport } from '@amma/shared';
import { ApiError, api } from '../../api';
import { ClientTabs } from '../ClientApp';
import { MerchantScreen } from '../screens/MerchantScreen';
import { ReportScreen } from '../screens/ReportScreen';
import { clientValue, WithClient } from '../../testing/clientFixtures';
import { plain } from '../../testing/fixtures';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn() };
});
const mockApi = api as jest.Mock;
beforeEach(() => mockApi.mockReset());

describe('Estabelecimento', () => {
  it('valida CNPJ e nome antes de enviar', async () => {
    await render(
      <WithClient value={clientValue({ isMerchant: true })}>
        <MerchantScreen />
      </WithClient>,
    );
    await fireEvent.press(screen.getByText('Salvar'));
    expect(screen.getByText('Informe o nome do estabelecimento.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Nome do estabelecimento'), 'Padaria da Lia');
    await fireEvent.changeText(screen.getByLabelText('CNPJ (opcional)'), '11222333000182');
    await fireEvent.press(screen.getByText('Salvar'));
    expect(screen.getByText(/CNPJ inválido/)).toBeTruthy();
    expect(screen.getByLabelText('CNPJ (opcional)').props.value).toBe('11.222.333/0001-82');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('salva com o endereço geocodificado e atualiza o estado do app', async () => {
    const setMerchant = jest.fn();
    mockApi.mockImplementation(async (_p: string, o: { body: object }) => ({
      ...o.body,
      cnpj: '11222333000181',
    }));
    await render(
      <WithClient value={clientValue({ isMerchant: true, setMerchant })}>
        <MerchantScreen />
      </WithClient>,
    );
    await fireEvent.changeText(
      screen.getByLabelText('Nome do estabelecimento'),
      ' Padaria da Lia ',
    );
    await fireEvent.changeText(screen.getByLabelText('CNPJ (opcional)'), '11222333000181');
    await fireEvent.changeText(screen.getByLabelText('Endereço'), 'Av. Epitácio Pessoa, 100');
    await fireEvent.press(screen.getByText('Salvar'));
    expect(await screen.findByText('Estabelecimento salvo.')).toBeTruthy();
    const [path, opts] = mockApi.mock.calls[0]!;
    expect(path).toBe('/merchant');
    expect(opts).toMatchObject({
      method: 'PUT',
      body: { tradeName: 'Padaria da Lia', cnpj: '11.222.333/0001-81', lat: -7.115, lng: -34.861 },
    });
    expect(setMerchant).toHaveBeenCalled();
  });

  it('endereço inexistente: avisa e não envia', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValueOnce([]);
    await render(
      <WithClient value={clientValue({ isMerchant: true })}>
        <MerchantScreen />
      </WithClient>,
    );
    await fireEvent.changeText(screen.getByLabelText('Nome do estabelecimento'), 'Padaria');
    await fireEvent.changeText(screen.getByLabelText('Endereço'), 'lugar nenhum xyz');
    await fireEvent.press(screen.getByText('Salvar'));
    expect(await screen.findByText(/Não encontramos esse endereço/)).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('erro do servidor (CNPJ já cadastrado) aparece na tela', async () => {
    mockApi.mockRejectedValue(new ApiError(409, 'Este CNPJ já está cadastrado'));
    await render(
      <WithClient value={clientValue({ isMerchant: true })}>
        <MerchantScreen />
      </WithClient>,
    );
    await fireEvent.changeText(screen.getByLabelText('Nome do estabelecimento'), 'Padaria');
    await fireEvent.changeText(screen.getByLabelText('Endereço'), 'Av. Central, 5');
    await fireEvent.press(screen.getByText('Salvar'));
    expect(await screen.findByText('Este CNPJ já está cadastrado')).toBeTruthy();
  });
});

const report = (days: number): MerchantReport => ({
  days,
  from: '2026-10-23',
  to: '2026-10-29',
  total: 4,
  delivered: 2,
  cancelled: 1,
  inProgress: 1,
  spentCents: 2200,
  refundedCents: 1100,
  averageTicketCents: 1100,
  cancelRatePercent: 25,
  perDay: [
    '2026-10-23',
    '2026-10-24',
    '2026-10-25',
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
  ].map((date, i) => ({ date, deliveries: i === 6 ? 4 : 0, spentCents: i === 6 ? 2200 : 0 })),
});

describe('Relatório', () => {
  it('mostra totais e gasto por dia; trocar o período recarrega', async () => {
    mockApi.mockImplementation(async (p: string) => report(Number(/days=(\d+)/.exec(p)![1])));
    await render(<ReportScreen />);
    expect(plain(String((await screen.findByTestId('report-spent')).props.children))).toBe(
      'R$ 22,00',
    );
    expect(screen.getByText('1 (25%)')).toBeTruthy();
    expect(screen.getByTestId('day-2026-10-29')).toBeTruthy();
    await fireEvent.press(screen.getByText('30 dias'));
    await waitFor(() => expect(mockApi).toHaveBeenLastCalledWith('/merchant/report?days=30'));
  });

  it('erro: tela de erro com nova tentativa', async () => {
    mockApi.mockRejectedValue(new ApiError(0, 'Sem conexão com o servidor.'));
    await render(<ReportScreen />);
    expect(await screen.findByText('Sem conexão com o servidor.')).toBeTruthy();
  });
});

describe('Abas do cliente', () => {
  it('passageiro: Entrega, Corrida, Pedidos e Conta', async () => {
    await render(
      <WithClient value={clientValue()}>
        <ClientTabs />
      </WithClient>,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    for (const label of ['Entrega', 'Corrida', 'Pedidos', 'Conta'])
      expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Loja')).toBeNull();
    expect(screen.queryByText('Relatório')).toBeNull();
  });

  it('quem não é passageiro (só comerciante) não vê a aba Corrida', async () => {
    mockApi.mockResolvedValue(report(7));
    await render(
      <WithClient value={clientValue({ isMerchant: true, isPassenger: false })}>
        <ClientTabs />
      </WithClient>,
    );
    expect(screen.queryByText('Corrida')).toBeNull();
    for (const label of ['Entrega', 'Pedidos', 'Loja', 'Relatório', 'Conta'])
      expect(screen.getByText(label)).toBeTruthy();
  });

  it('comerciante também vê Loja e Relatório', async () => {
    mockApi.mockResolvedValue(report(7));
    await render(
      <WithClient value={clientValue({ isMerchant: true })}>
        <ClientTabs />
      </WithClient>,
    );
    for (const label of ['Entrega', 'Pedidos', 'Loja', 'Relatório', 'Conta'])
      expect(screen.getByText(label)).toBeTruthy();
    await fireEvent.press(screen.getByText('Loja'));
    expect(screen.getByText('Meu estabelecimento')).toBeTruthy();
  });
});
