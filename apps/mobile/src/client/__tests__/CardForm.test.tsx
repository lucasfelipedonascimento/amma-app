import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { CardForm, EMPTY_CARD, cardProblem, type CardFields } from '../components/CardForm';

const now = new Date('2026-10-30T12:00:00Z');
const ok: CardFields = { number: '4242 4242 4242 4242', expiry: '12/29', cvv: '123' };

describe('cartão', () => {
  it('aponta o primeiro problema, na ordem número → validade → CVV', () => {
    expect(cardProblem(ok, now)).toBeNull();
    expect(cardProblem({ ...ok, number: '4242 4242 4242 4241' }, now)).toMatch(/número/);
    expect(cardProblem({ ...ok, expiry: '09/26' }, now)).toMatch(/Validade/);
    expect(cardProblem({ ...ok, cvv: '12' }, now)).toMatch(/segurança/);
    expect(cardProblem(EMPTY_CARD, now)).toMatch(/número/);
  });

  it('digitação ganha máscara e CVV só aceita números', async () => {
    function Host() {
      const [v, setV] = useState(EMPTY_CARD);
      return <CardForm value={v} onChange={setV} sandbox />;
    }
    await render(<Host />);
    await fireEvent.changeText(screen.getByLabelText('Número do cartão'), '4242424242424242');
    await fireEvent.changeText(screen.getByLabelText('Validade'), '1229');
    await fireEvent.changeText(screen.getByLabelText('Código (CVV)'), '1a2b3');
    expect(screen.getByLabelText('Número do cartão').props.value).toBe('4242 4242 4242 4242');
    expect(screen.getByLabelText('Validade').props.value).toBe('12/29');
    expect(screen.getByLabelText('Código (CVV)').props.value).toBe('123');
    expect(screen.getByText(/Ambiente de testes/)).toBeTruthy();
  });

  it('fora do sandbox não mostra o aviso de teste', async () => {
    await render(<CardForm value={EMPTY_CARD} onChange={() => {}} sandbox={false} />);
    expect(screen.queryByText(/Ambiente de testes/)).toBeNull();
  });
});
