import { fireEvent, render, screen } from '@testing-library/react-native';
import { DriverHome } from '../screens/DriverHome';
import { active, driverValue, earnings, offer, plain, WithDriver } from '../../testing/fixtures';

jest.mock('../../session', () => ({ useSession: () => ({ me: { name: 'Maria Silva' } }) }));

const renderHome = (over = {}) =>
  render(
    <WithDriver value={driverValue(over)}>
      <DriverHome />
    </WithDriver>,
  );

describe('Início do motorista', () => {
  it('offline: convida a ficar online e não mostra pedido', async () => {
    const goOnline = jest.fn(async () => undefined);
    await renderHome({ goOnline });
    expect(screen.getByText('Olá, Maria')).toBeTruthy();
    expect(screen.getByTestId('presence-label').props.children).toBe('Você está offline');
    expect(screen.getByText('Fique online para começar a receber pedidos.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Ficar online'));
    expect(goOnline).toHaveBeenCalledTimes(1);
  });

  it('online sem pedido: mostra que está procurando e permite ficar offline', async () => {
    const goOffline = jest.fn(async () => undefined);
    await renderHome({ online: true, realtime: 'open', goOffline });
    expect(screen.getByText('Procurando pedidos perto de você…')).toBeTruthy();
    await fireEvent.press(screen.getByText('Ficar offline'));
    expect(goOffline).toHaveBeenCalledTimes(1);
  });

  it('mostra os ganhos do dia com o comparativo de 25%', async () => {
    await renderHome();
    expect(screen.getByText('Ganhos de hoje')).toBeTruthy();
    expect(plain(String(screen.getByTestId('net-total').props.children))).toBe('R$ 9,68');
    expect(screen.getByText(/Num app com 25% de taxa/)).toBeTruthy();
  });

  it('pedido novo: mostra a oferta e Aceitar/Recusar agem', async () => {
    const accept = jest.fn(async () => undefined);
    const decline = jest.fn(async () => undefined);
    await renderHome({ online: true, realtime: 'open', offer, accept, decline });
    expect(screen.getByText('Novo pedido')).toBeTruthy();
    expect(screen.queryByText('Procurando pedidos perto de você…')).toBeNull();
    await fireEvent.press(screen.getByText('Aceitar'));
    await fireEvent.press(screen.getByText('Recusar'));
    expect(accept).toHaveBeenCalledTimes(1);
    expect(decline).toHaveBeenCalledTimes(1);
  });

  it('com entrega em andamento não deixa ficar offline', async () => {
    await renderHome({ online: true, realtime: 'open', active });
    expect(screen.getByText(/Termine a entrega em andamento/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Ficar offline' }).props.accessibilityState,
    ).toMatchObject({
      disabled: true,
    });
  });

  it('sem internet: faixa de aviso', async () => {
    await renderHome({ offline: true });
    expect(screen.getByText(/Sem internet/)).toBeTruthy();
  });

  it('online com o tempo real caído: avisa que está reconectando', async () => {
    await renderHome({ online: true, realtime: 'closed' });
    expect(screen.getByText(/Reconectando ao tempo real/)).toBeTruthy();
  });

  it('erro nos ganhos: mostra o motivo e permite tentar de novo', async () => {
    const refreshEarnings = jest.fn(async () => undefined);
    await renderHome({
      earnings: null,
      earningsError: 'Sem conexão com o servidor.',
      refreshEarnings,
    });
    expect(screen.getByText(/Sem conexão com o servidor/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Tentar de novo'));
    expect(refreshEarnings).toHaveBeenCalledTimes(1);
  });

  it('só localização com o app aberto: explica e oferece as configurações', async () => {
    const openSettings = jest.fn();
    await renderHome({ online: true, access: 'foreground', openSettings });
    expect(screen.getByText('Só com o app aberto')).toBeTruthy();
    await fireEvent.press(screen.getByText('Abrir configurações'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('mostra o resultado da entrega recém-concluída', async () => {
    const dismissCompleted = jest.fn();
    await renderHome({ completed: { fareCents: 1100, workerNetCents: 968 }, dismissCompleted });
    expect(screen.getByText('Entrega concluída ✓')).toBeTruthy();
    expect(plain(screen.getByText(/Você recebeu/).props.children.join(''))).toContain('R$ 9,68');
    await fireEvent.press(screen.getByText('Ok'));
    expect(dismissCompleted).toHaveBeenCalled();
  });

  it('mostra erro de ação (ex.: falha ao ficar online)', async () => {
    await renderHome({ actionError: 'Cadastro ainda não aprovado.' });
    expect(screen.getByText('Cadastro ainda não aprovado.')).toBeTruthy();
  });

  it('usa os ganhos do fixture', () => {
    expect(earnings.today.extraCents).toBe(143);
  });
});
