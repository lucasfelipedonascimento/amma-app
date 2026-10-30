import { useState } from 'react';
import { Text } from 'react-native';
import { colors } from '../theme';
import { Loaded, Tag, muted, strong } from '../association/parts';
import { useLoad } from '../association/useLoad';
import { Button } from '../ui';
import { Card } from '../driver/components/layout';
import { formatDateTime } from '../driver/format';
import { REPORT_LABEL, REPORT_STATUS_LABEL, TYPE_LABEL } from './labels';
import { RateCard } from './parts';
import type { HistoryItem, MyReport } from './types';

/** Suas visitas (para avaliar o ponto) e suas denúncias com a resposta da associação. */
export function VisitsTab() {
  const history = useLoad<HistoryItem[]>('/welcome-points/check-ins/mine');
  const reports = useLoad<MyReport[]>('/welcome-points/reports/mine');
  const [rating, setRating] = useState<string | null>(null);

  return (
    <>
      <Text style={strong}>Minhas visitas</Text>
      <Loaded data={history.data} error={history.error} onRetry={() => void history.reload()}>
        {(list) =>
          list.length === 0 ? (
            <Text style={muted}>Você ainda não visitou nenhum ponto.</Text>
          ) : (
            <>
              {list.map((h) => (
                <Card key={h.id}>
                  <Text style={strong}>{h.point.name}</Text>
                  <Text style={muted}>
                    {TYPE_LABEL[h.point.type]} · {formatDateTime(h.startedAt)}
                  </Text>
                  {!h.completed ? (
                    <Text style={muted}>Visita curta ou encerrada sozinha: não conta.</Text>
                  ) : null}
                  {h.rated ? <Tag text="Você avaliou" color={colors.ok} /> : null}
                  {h.canRate && rating !== h.id ? (
                    <Button
                      title="Avaliar este ponto"
                      kind="ghost"
                      onPress={() => setRating(h.id)}
                    />
                  ) : null}
                  {rating === h.id ? (
                    <RateCard
                      title={`Como foi em ${h.point.name}?`}
                      path={`/welcome-points/check-ins/${h.id}/rate`}
                      onDone={() => {
                        setRating(null);
                        void history.reload();
                      }}
                    />
                  ) : null}
                </Card>
              ))}
            </>
          )
        }
      </Loaded>
      <Text style={strong}>Minhas denúncias</Text>
      <Loaded data={reports.data} error={reports.error} onRetry={() => void reports.reload()}>
        {(list) =>
          list.length === 0 ? (
            <Text style={muted}>Nenhuma denúncia feita.</Text>
          ) : (
            <>
              {list.map((r) => (
                <Card key={r.id}>
                  <Text style={strong}>{r.pointName}</Text>
                  <Text style={muted}>
                    {REPORT_LABEL[r.category]} · {formatDateTime(r.createdAt)}
                  </Text>
                  <Tag
                    text={REPORT_STATUS_LABEL[r.status]}
                    color={r.status === 'ABERTA' ? colors.warn : colors.muted}
                  />
                  {r.response ? <Text style={muted}>Resposta: {r.response}</Text> : null}
                </Card>
              ))}
            </>
          )
        }
      </Loaded>
    </>
  );
}
