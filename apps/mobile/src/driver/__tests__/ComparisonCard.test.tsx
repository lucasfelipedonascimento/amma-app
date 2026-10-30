import { render, screen } from '@testing-library/react-native';
import { ComparisonCard } from '../components/ComparisonCard';
import { plain } from '../../testing/fixtures';

const cmp = { competitorFeeCents: 275, competitorNetCents: 825, extraCents: 143 };
const text = (id: string) => plain([screen.getByTestId(id).props.children].flat().join(''));

describe('ComparisonCard', () => {
  it('compara o líquido da AMMA com um app que cobra 25%', async () => {
    await render(
      <ComparisonCard
        title="Ganhos de hoje"
        deliveries={1}
        grossCents={1100}
        netCents={968}
        comparison={cmp}
      />,
    );
    expect(text('net-total')).toBe('R$ 9,68');
    expect(screen.getByText(/Num app com 25% de taxa/)).toBeTruthy();
    expect(screen.getByText(/R\$\s8,25/)).toBeTruthy();
    expect(text('extra-total')).toBe('+ R$ 1,43');
    expect(screen.getByText(/1 entrega ·/)).toBeTruthy();
  });

  it('sem entregas não promete vantagem', async () => {
    await render(
      <ComparisonCard
        title="Ganhos de hoje"
        deliveries={0}
        grossCents={0}
        netCents={0}
        comparison={{ competitorFeeCents: 0, competitorNetCents: 0, extraCents: 0 }}
      />,
    );
    expect(screen.queryByTestId('extra-total')).toBeNull();
    expect(screen.getByText(/0 entregas/)).toBeTruthy();
  });
});
