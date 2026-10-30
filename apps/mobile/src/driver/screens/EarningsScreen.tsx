import { Text } from 'react-native';
import { businessDay } from '@amma/shared';
import { colors } from '../../theme';
import { ComparisonCard } from '../components/ComparisonCard';
import { HistoryList } from '../components/HistoryList';
import { Card, Heading, Page } from '../components/layout';
import { Simulator } from '../components/Simulator';
import { ErrorView, LoadingView, OfflineBanner } from '../components/states';
import { WeekChart } from '../components/WeekChart';
import { useDriver } from '../DriverProvider';

/** Ganhos: semana (dia a dia), histórico de entregas e simulador. */
export function EarningsScreen() {
  const d = useDriver();
  const e = d.earnings;

  if (!e) {
    if (d.earningsError)
      return <ErrorView message={d.earningsError} onRetry={() => void d.refreshEarnings()} />;
    return <LoadingView label="Carregando seus ganhos…" />;
  }
  return (
    <>
      {d.offline ? <OfflineBanner /> : null}
      <Page onRefresh={() => void d.refreshEarnings()}>
        <Heading>Ganhos</Heading>
        {d.earningsError ? (
          <Text style={{ color: colors.warn }}>Não foi possível atualizar: {d.earningsError}</Text>
        ) : null}
        <ComparisonCard
          title="Últimos 7 dias"
          deliveries={e.week.deliveries}
          grossCents={e.week.grossCents}
          netCents={e.week.netCents}
          comparison={e.week}
        />
        <Card>
          <WeekChart days={e.week.days} today={businessDay(new Date())} />
        </Card>
        <Simulator initialRate={e.associationRate} />
        <Heading>Histórico</Heading>
        <HistoryList items={e.history} />
      </Page>
    </>
  );
}
