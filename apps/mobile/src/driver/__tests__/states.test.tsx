import { fireEvent, render, screen } from '@testing-library/react-native';
import { ErrorView, LoadingView, OfflineBanner } from '../components/states';

describe('estados de carregamento, erro e sem conexão', () => {
  it('carregando', async () => {
    await render(<LoadingView label="Carregando seus ganhos…" />);
    expect(screen.getByText('Carregando seus ganhos…')).toBeTruthy();
  });

  it('erro mostra a mensagem e tenta de novo', async () => {
    const onRetry = jest.fn();
    await render(<ErrorView message="Sem conexão com o servidor." onRetry={onRetry} />);
    expect(screen.getByText('Sem conexão com o servidor.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Tentar de novo'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('faixa de sem internet', async () => {
    await render(<OfflineBanner />);
    expect(screen.getByText(/Sem internet/)).toBeTruthy();
  });
});
