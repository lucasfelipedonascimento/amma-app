import { fireEvent, render, screen } from '@testing-library/react-native';
import { Simulator } from '../components/Simulator';
import { plain } from '../../testing/fixtures';

const text = (id: string) => plain([screen.getByTestId(id).props.children].flat().join(''));

describe('Simulator', () => {
  it('R$ 11,00 a 2%: líquido R$ 9,68 e R$ 1,43 a mais que no app de 25%', async () => {
    await render(<Simulator initialRate={2} />);
    await fireEvent.changeText(screen.getByLabelText('Valor da corrida'), '11,00');
    expect(text('sim-net')).toBe('R$ 9,68');
    expect(text('sim-extra')).toBe('+ R$ 1,43');
  });

  it('trocar a taxa de associação recalcula', async () => {
    await render(<Simulator initialRate={0} />);
    await fireEvent.changeText(screen.getByLabelText('Valor da corrida'), '100');
    expect(text('sim-net')).toBe('R$ 90,00');
    await fireEvent.press(screen.getByText('4%'));
    expect(text('sim-net')).toBe('R$ 86,00');
  });

  it('valor inválido ou zero não mostra resultado', async () => {
    await render(<Simulator />);
    await fireEvent.changeText(screen.getByLabelText('Valor da corrida'), 'abc');
    expect(screen.queryByTestId('sim-net')).toBeNull();
    expect(screen.getByText('Digite um valor para ver quanto sobra.')).toBeTruthy();
  });
});
