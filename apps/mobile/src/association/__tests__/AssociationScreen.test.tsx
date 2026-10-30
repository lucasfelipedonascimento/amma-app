import { fireEvent, render, screen } from '@testing-library/react-native';
import { api } from '../../api';
import { DriverTabs } from '../../driver/DriverApp';
import { driverValue, WithDriver } from '../../testing/fixtures';
import { AssociationScreen } from '../AssociationScreen';
import { me, proposal, routes } from '../../testing/associationFixtures';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});
jest.mock('../../session', () => ({
  useSession: () => ({ me: { name: 'Maria', phone: '+5583' }, signOut: jest.fn() }),
}));
jest.mock('../../driver/useRouteInfo', () => ({
  useRouteInfo: () => ({ route: null, error: null }),
}));

beforeEach(() => {
  (api as jest.Mock).mockReset();
  routes({
    'GET /association/me': me(),
    'GET /association/surplus': [],
    'GET /assembly/proposals': [proposal()],
    'GET /purchase-groups': [],
    'GET /insurance/claims': [],
  });
});

describe('área da associação', () => {
  it('abre no resumo e troca entre assembleia, compra e seguro', async () => {
    await render(<AssociationScreen />);
    expect(await screen.findByText('Seu nível: Bronze')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Assembleia' }));
    expect(await screen.findByText('Reajustar a taxa')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Compra' }));
    expect(await screen.findByText(/Nenhum grupo de compra aberto/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Seguro' }));
    expect(await screen.findByText('Novo pedido de seguro')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Resumo' }));
    expect(await screen.findByText('Seu nível: Bronze')).toBeTruthy();
  });

  it('o app do motorista tem a aba AMMA', async () => {
    await render(
      <WithDriver value={driverValue()}>
        <DriverTabs />
      </WithDriver>,
    );
    await fireEvent.press(screen.getByRole('tab', { name: 'AMMA' }));
    expect(await screen.findByText('Seu nível: Bronze')).toBeTruthy();
  });
});
