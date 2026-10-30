import { fireEvent, render, screen } from '@testing-library/react-native';
import { EarningsScreen } from '../screens/EarningsScreen';
import { driverValue, WithDriver } from '../../testing/fixtures';

const renderScreen = (over = {}) =>
  render(
    <WithDriver value={driverValue(over)}>
      <EarningsScreen />
    </WithDriver>,
  );

describe('Ganhos', () => {
  it('mostra a semana, o gráfico dia a dia, o simulador e o histórico', async () => {
    await renderScreen();
    expect(screen.getByText('Últimos 7 dias')).toBeTruthy();
    expect(screen.getByTestId('day-2026-10-29')).toBeTruthy();
    expect(screen.getAllByText(/^(seg|ter|qua|qui|sex|sáb|dom)$/)).toHaveLength(7);
    expect(screen.getByText('Simulador')).toBeTruthy();
    expect(screen.getByText('Histórico')).toBeTruthy();
    expect(screen.getByTestId('history-h1')).toBeTruthy();
  });

  it('histórico vazio', async () => {
    await renderScreen({ earnings: { ...driverValue().earnings!, history: [] } });
    expect(screen.getByText('Nenhuma entrega concluída ainda.')).toBeTruthy();
  });

  it('carregando a primeira vez', async () => {
    await renderScreen({ earnings: null });
    expect(screen.getByText('Carregando seus ganhos…')).toBeTruthy();
  });

  it('erro sem dados: tela de erro com nova tentativa', async () => {
    const refreshEarnings = jest.fn(async () => undefined);
    await renderScreen({
      earnings: null,
      earningsError: 'Sem conexão com o servidor.',
      refreshEarnings,
    });
    expect(screen.getByText('Sem conexão com o servidor.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Tentar de novo'));
    expect(refreshEarnings).toHaveBeenCalled();
  });

  it('erro ao atualizar mantém os dados antigos na tela', async () => {
    await renderScreen({ earningsError: 'Sem conexão com o servidor.' });
    expect(screen.getByText(/Não foi possível atualizar/)).toBeTruthy();
    expect(screen.getByText('Últimos 7 dias')).toBeTruthy();
  });

  it('sem internet: faixa de aviso', async () => {
    await renderScreen({ offline: true });
    expect(screen.getByText(/Sem internet/)).toBeTruthy();
  });
});
