import { useState } from 'react';
import { Text } from 'react-native';
import { api } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText } from '../ui';
import { Segments, muted, strong } from '../association/parts';
import { useLoad } from '../association/useLoad';
import { Card, Heading, Page } from '../driver/components/layout';
import { formatDateTime } from '../driver/format';
import { MapTab } from './MapTab';
import { MineTab } from './MineTab';
import { RateCard } from './parts';
import { RegisterTab } from './RegisterTab';
import { VisitsTab } from './VisitsTab';
import type { ActiveCheckIn, CheckInView } from './types';

type Section = 'mapa' | 'cadastrar' | 'meus' | 'visitas';

/** Pontos de acolhida no app do motorista: mapa, cadastro, meus pontos e visitas. */
export function WelcomeScreen() {
  const [section, setSection] = useState<Section>('mapa');
  const active = useLoad<ActiveCheckIn>('/welcome-points/check-ins/active');
  const [ended, setEnded] = useState<(CheckInView & { canRate: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const end = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setEnded(await api(`/welcome-points/check-ins/${id}/end`, { method: 'POST', body: {} }));
      await active.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const here = active.data?.checkIn ? active.data : null;

  return (
    <Page>
      <Heading>Pontos de acolhida</Heading>
      {here?.checkIn && here.point ? (
        <Card>
          <Text style={strong}>Você está em {here.point.name}</Text>
          <Text style={muted}>
            Check-in às {formatDateTime(here.checkIn.startedAt)}.
            {here.point.address ? ` ${here.point.address}.` : ''}
          </Text>
          <Text style={muted}>
            Ficando {here.checkIn.minMinutes} minutos ou mais, a visita conta.
          </Text>
          <ErrorText message={error} />
          <Button title="Sair do ponto" onPress={() => void end(here.checkIn!.id)} loading={busy} />
        </Card>
      ) : null}
      {ended ? (
        ended.canRate ? (
          <RateCard
            title="Como foi? Avalie o ponto"
            path={`/welcome-points/check-ins/${ended.id}/rate`}
            onDone={() => setEnded(null)}
          />
        ) : (
          <Card>
            <Text style={{ color: colors.black }}>
              Visita muito curta: ela não conta e não pode ser avaliada. Se algo estava errado,
              denuncie o ponto.
            </Text>
            <Button title="Ok" kind="ghost" onPress={() => setEnded(null)} />
          </Card>
        )
      ) : null}
      <Segments
        items={[
          { key: 'mapa', label: 'Mapa' },
          { key: 'cadastrar', label: 'Cadastrar' },
          { key: 'meus', label: 'Meus' },
          { key: 'visitas', label: 'Visitas' },
        ]}
        current={section}
        onChange={setSection}
      />
      {section === 'mapa' && <MapTab onCheckedIn={() => void active.reload()} />}
      {section === 'cadastrar' && <RegisterTab onDone={() => setSection('meus')} />}
      {section === 'meus' && <MineTab />}
      {section === 'visitas' && <VisitsTab />}
    </Page>
  );
}
