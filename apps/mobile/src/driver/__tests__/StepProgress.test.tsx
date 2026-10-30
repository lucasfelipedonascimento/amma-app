import { render, screen } from '@testing-library/react-native';
import { StepProgress } from '../components/StepProgress';

describe('StepProgress', () => {
  it('mostra as 4 etapas', async () => {
    await render(<StepProgress done={0} />);
    ['Indo à coleta', 'Coletado', 'Indo à entrega', 'Entregue'].forEach((l) =>
      expect(screen.getByText(l)).toBeTruthy(),
    );
  });

  it('marca as concluídas e destaca a atual', async () => {
    await render(<StepProgress done={2} />);
    expect(screen.getAllByText('✓')).toHaveLength(2);
    expect(screen.getByTestId('step-2').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('step-0').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('step-3').props.accessibilityState).toMatchObject({
      selected: false,
      checked: false,
    });
  });

  it('tudo concluído não destaca nenhuma', async () => {
    await render(<StepProgress done={4} />);
    expect(screen.getAllByText('✓')).toHaveLength(4);
  });
});
