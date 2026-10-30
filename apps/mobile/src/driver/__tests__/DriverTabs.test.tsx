import { fireEvent, render, screen } from '@testing-library/react-native';
import { DriverTabs } from '../DriverApp';
import { active, driverValue, WithDriver } from '../../testing/fixtures';

jest.mock('../../session', () => ({
  useSession: () => ({ me: { name: 'Maria', phone: '+5583' }, signOut: jest.fn() }),
}));
jest.mock('../useRouteInfo', () => ({ useRouteInfo: () => ({ route: null, error: null }) }));

const renderTabs = (over = {}) =>
  render(
    <WithDriver value={driverValue(over)}>
      <DriverTabs />
    </WithDriver>,
  );

describe('DriverTabs', () => {
  it('primeiro carregamento mostra o indicador de progresso', async () => {
    await renderTabs({ ready: false });
    expect(screen.getByText('Carregando…')).toBeTruthy();
  });

  it('falha ao carregar mostra o erro e tenta de novo', async () => {
    const reload = jest.fn(async () => undefined);
    await renderTabs({ ready: false, loadError: 'Sem conexão com o servidor.', reload });
    expect(screen.getByText('Sem conexão com o servidor.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Tentar de novo'));
    expect(reload).toHaveBeenCalled();
  });

  it('sem consentimento ao tentar ficar online: tela de consentimento antes de tudo', async () => {
    const acceptConsent = jest.fn(async () => undefined);
    await renderTabs({ consented: false, consentOpen: true, acceptConsent });
    expect(screen.getByText('Sua localização')).toBeTruthy();
    expect(screen.queryByText('Ficar online')).toBeNull();
    await fireEvent.press(screen.getByText('Concordo e continuar'));
    expect(acceptConsent).toHaveBeenCalled();
  });

  it('navega entre Início, Ganhos e Conta', async () => {
    await renderTabs();
    expect(screen.getByText('Ganhos de hoje')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Ganhos' }));
    expect(screen.getByText('Últimos 7 dias')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Conta' }));
    expect(screen.getByText('Revogar autorização')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Início' }));
    expect(screen.getByText('Ganhos de hoje')).toBeTruthy();
  });

  it('a aba Entrega só existe com pedido em andamento e abre sozinha', async () => {
    const { rerender } = await renderTabs();
    expect(screen.queryByRole('tab', { name: 'Entrega' })).toBeNull();
    await rerender(
      <WithDriver value={driverValue({ online: true, active })}>
        <DriverTabs />
      </WithDriver>,
    );
    expect(screen.getByRole('tab', { name: 'Entrega' })).toBeTruthy();
    expect(screen.getByTestId('map')).toBeTruthy();
    expect(screen.getByTestId('badge-entrega')).toBeTruthy();
  });

  it('terminou a entrega: volta ao Início', async () => {
    const { rerender } = await renderTabs({ online: true, active });
    expect(screen.getByTestId('map')).toBeTruthy();
    await rerender(
      <WithDriver value={driverValue({ online: true, active: null })}>
        <DriverTabs />
      </WithDriver>,
    );
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getByText('Ganhos de hoje')).toBeTruthy();
  });
});
