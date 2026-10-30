import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { OfferCard } from '../components/OfferCard';
import { offer, plain } from '../../testing/fixtures';

const text = (id: string) => plain([screen.getByTestId(id).props.children].flat().join(''));

describe('OfferCard', () => {
  it('mostra corrida, taxa base, taxa da associação e valor líquido', async () => {
    await render(<OfferCard offer={offer} onAccept={jest.fn()} onDecline={jest.fn()} />);
    expect(screen.getByText(/Rua da Coleta, 100/)).toBeTruthy();
    expect(screen.getByText(/Rua da Entrega, 200/)).toBeTruthy();
    expect(screen.getByText('Valor da corrida')).toBeTruthy();
    expect(screen.getByText('Taxa base (10%)')).toBeTruthy();
    expect(screen.getByText('Taxa da associação (2%)')).toBeTruthy();
    expect(screen.getByText(/R\$\s11,00/)).toBeTruthy();
    expect(screen.getByText(/−\sR\$\s1,10/)).toBeTruthy(); // taxa base
    expect(screen.getByText(/−\sR\$\s0,22/)).toBeTruthy(); // associação
    expect(text('offer-net')).toBe('R$ 9,68');
  });

  it('Aceitar e Recusar chamam os callbacks', async () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    await render(<OfferCard offer={offer} onAccept={onAccept} onDecline={onDecline} />);
    await fireEvent.press(screen.getByText('Aceitar'));
    await fireEvent.press(screen.getByText('Recusar'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Recusar não tem punição.')).toBeTruthy();
  });

  it('contagem regressiva até o vencimento', async () => {
    jest.useFakeTimers();
    try {
      const o = { ...offer, expiresAt: new Date(Date.now() + 30_000).toISOString() };
      await render(<OfferCard offer={o} onAccept={jest.fn()} onDecline={jest.fn()} />);
      expect(text('offer-timer')).toBe('30 s');
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      expect(text('offer-timer')).toBe('25 s');
    } finally {
      jest.useRealTimers();
    }
  });

  it('enquanto processa, os botões ficam travados (sem aceitar duas vezes)', async () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    await render(<OfferCard offer={offer} busy onAccept={onAccept} onDecline={onDecline} />);
    await fireEvent.press(screen.getByText('Recusar'));
    await fireEvent.press(screen.getByRole('button', { name: 'Aceitar' }));
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
  });
});
