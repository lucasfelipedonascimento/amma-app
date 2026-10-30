import { useState } from 'react';
import { Text } from 'react-native';
import { ASSOCIATION_RATES, formatBRL, type AssociationRate } from '@amma/shared';
import { api } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { ErrorText } from '../ui';
import { Card, Heading, Row } from '../driver/components/layout';
import { Bar, Chips, Loaded, Tag, muted, strong } from './parts';
import { LEVEL_LABEL } from './labels';
import type { AssociationMe, SurplusItem } from './types';
import { useLoad } from './useLoad';

/** Resumo do sócio: nível, progresso, taxa de associação e sobras recebidas. */
export function SummaryTab() {
  const me = useLoad<AssociationMe>('/association/me');
  const surplus = useLoad<SurplusItem[]>('/association/surplus');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseRate = async (rate: AssociationRate) => {
    setBusy(true);
    setError(null);
    try {
      await api('/driver/association-rate', { method: 'PUT', body: { rate } });
      await me.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Loaded data={me.data} error={me.error} onRetry={() => void me.reload()} label="Carregando…">
      {(m) => {
        const p = m.progress;
        return (
          <>
            <Card>
              <Text style={strong}>Seu nível: {LEVEL_LABEL[p.level]}</Text>
              <Bar percent={p.percent} testID="level-bar" />
              <Row label="Cotas" value={String(m.quotas)} testID="quotas" />
              {m.remainderCents > 0 ? (
                <Row label="Fração da próxima cota" value={formatBRL(m.remainderCents)} />
              ) : null}
              {p.nextLevel ? (
                <Text style={muted} testID="next-level">
                  Faltam {p.quotasToNext} cotas ({formatBRL(p.centsToNext ?? 0)} em taxa) para o
                  nível {LEVEL_LABEL[p.nextLevel]}.
                </Text>
              ) : (
                <Text style={muted}>Você está no nível mais alto.</Text>
              )}
              <Text style={muted}>
                1 cota = {formatBRL(m.quotaValueCents)}. Cotas são um registro da associação, não
                dinheiro guardado no app.
              </Text>
              {!m.isMember ? (
                <Tag
                  color={colors.warn}
                  text={`Você ainda não é sócio: precisa de ${m.minQuotasToBeMember} cota para votar e participar.`}
                />
              ) : (
                <Tag color={colors.ok} text="Sócio" />
              )}
            </Card>

            <Card>
              <Text style={strong}>Taxa da associação</Text>
              <Text style={muted}>
                Quanto de cada corrida vira cota sua, além da taxa base de 10%. Vale para as
                próximas corridas.
              </Text>
              <Chips
                items={ASSOCIATION_RATES.map((r) => ({ key: r, label: `${r}%` }))}
                current={m.associationRate}
                onChange={(r) => void chooseRate(r)}
                disabled={busy}
              />
              <ErrorText message={error} />
            </Card>

            <Heading>Sobras</Heading>
            <Loaded data={surplus.data} error={surplus.error} onRetry={() => void surplus.reload()}>
              {(list) =>
                list.length === 0 ? (
                  <Text style={muted}>
                    Ainda não há sobras fechadas. Elas são divididas uma vez por ano, pelo seu uso e
                    pelas suas cotas.
                  </Text>
                ) : (
                  <>
                    {list.map((s) => (
                      <Card key={s.year}>
                        <Row
                          label={`Sobras de ${s.year}`}
                          value={formatBRL(s.amountCents)}
                          strong
                        />
                        <Text style={muted}>
                          {s.quotas} cotas · {formatBRL(s.useCents)} em corridas ·{' '}
                          {s.useWeightPercent}% pelo uso
                        </Text>
                      </Card>
                    ))}
                  </>
                )
              }
            </Loaded>
          </>
        );
      }}
    </Loaded>
  );
}
