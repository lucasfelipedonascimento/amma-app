import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { api } from '../api';
import { errorMessage } from '../errors';
import { colors } from '../theme';
import { Button, ErrorText } from '../ui';
import { formatDateTime } from '../driver/format';
import { Card, Heading, Row } from '../driver/components/layout';
import { BackLink, Bar, Loaded, Tag, muted, strong } from './parts';
import { PROPOSAL_STATUS_LABEL, VOTE_LABEL, ruleLabel } from './labels';
import type { Proposal, VoteChoice } from './types';
import { useLoad } from './useLoad';

const CHOICES: VoteChoice[] = ['SIM', 'NAO', 'ABSTENCAO'];

/** Assembleia: propostas, voto (1 sócio = 1 voto, pode mudar até o fechamento) e resultados. */
export function AssemblyTab() {
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useLoad<Proposal[]>('/assembly/proposals');

  if (openId)
    return (
      <ProposalDetail
        id={openId}
        onBack={() => {
          setOpenId(null);
          void list.reload();
        }}
      />
    );
  return (
    <Loaded data={list.data} error={list.error} onRetry={() => void list.reload()}>
      {(items) =>
        items.length === 0 ? (
          <Text style={muted}>
            Nenhuma proposta ainda. Quando a associação abrir uma votação, ela aparece aqui.
          </Text>
        ) : (
          <>
            {items.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setOpenId(p.id)}
                accessibilityRole="button"
                accessibilityLabel={p.title}
              >
                <Card>
                  <Text style={strong}>{p.title}</Text>
                  <Tag
                    text={PROPOSAL_STATUS_LABEL[p.status]}
                    color={
                      p.status === 'ABERTA'
                        ? colors.red
                        : p.status === 'APROVADA'
                          ? colors.ok
                          : colors.muted
                    }
                  />
                  <Text style={muted}>
                    {p.status === 'ABERTA'
                      ? p.myVote
                        ? `Seu voto: ${VOTE_LABEL[p.myVote]} · até ${formatDateTime(p.closesAt)}`
                        : `Você ainda não votou · até ${formatDateTime(p.closesAt)}`
                      : `Encerrada em ${formatDateTime(p.closesAt)}`}
                  </Text>
                </Card>
              </Pressable>
            ))}
          </>
        )
      }
    </Loaded>
  );
}

function ProposalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, reload, setData } = useLoad<Proposal>(`/assembly/proposals/${id}`);
  const [busy, setBusy] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const vote = async (choice: VoteChoice) => {
    setBusy(true);
    setVoteError(null);
    try {
      setData(
        await api<Proposal>(`/assembly/proposals/${id}/vote`, { method: 'PUT', body: { choice } }),
      );
    } catch (e) {
      setVoteError(errorMessage(e));
      void reload(); // a votação pode ter fechado enquanto a tela estava aberta
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BackLink onPress={onBack} />
      <Loaded data={data} error={error} onRetry={() => void reload()}>
        {(p) => (
          <>
            <Heading>{p.title}</Heading>
            <Tag
              text={PROPOSAL_STATUS_LABEL[p.status]}
              color={
                p.status === 'ABERTA'
                  ? colors.red
                  : p.status === 'APROVADA'
                    ? colors.ok
                    : colors.muted
              }
            />
            <Text style={{ color: colors.black }}>{p.description}</Text>
            {p.ruleChange ? (
              <Card>
                <Text style={strong}>Regra proposta</Text>
                {Object.entries(p.ruleChange).map(([k, v]) => (
                  <Row key={k} label={ruleLabel(k)} value={String(v)} />
                ))}
              </Card>
            ) : null}

            {p.status === 'ABERTA' ? (
              <Card>
                <Text style={strong}>Seu voto</Text>
                <Text style={muted}>
                  Cada sócio tem um voto. Você pode mudar até {formatDateTime(p.closesAt)}. A
                  contagem só aparece depois do fechamento.
                </Text>
                {CHOICES.map((c) => (
                  <Button
                    key={c}
                    title={VOTE_LABEL[c]}
                    kind={p.myVote === c ? 'primary' : 'ghost'}
                    onPress={() => void vote(c)}
                    disabled={busy}
                  />
                ))}
                {p.myVote ? (
                  <Text style={muted}>Seu voto atual: {VOTE_LABEL[p.myVote]}</Text>
                ) : null}
                <ErrorText message={voteError} />
              </Card>
            ) : (
              <Card>
                <Text style={strong}>Resultado</Text>
                {p.result ? (
                  <>
                    <Row label="Sim" value={String(p.result.yes)} />
                    <Row label="Não" value={String(p.result.no)} />
                    <Row label="Abstenções" value={String(p.result.abstain)} />
                    <Bar
                      percent={
                        p.result.yes + p.result.no > 0
                          ? Math.round((p.result.yes / (p.result.yes + p.result.no)) * 100)
                          : 0
                      }
                    />
                    <Text style={muted}>
                      {p.result.total} de {p.eligibleCount} sócios votaram
                      {p.quorumPercent > 0 ? ` (mínimo ${p.requiredVotes})` : ''}.
                    </Text>
                  </>
                ) : null}
                {p.myVote ? <Text style={muted}>Seu voto: {VOTE_LABEL[p.myVote]}</Text> : null}
                {p.result?.appliedRulesVersion ? (
                  <Text style={{ color: colors.ok, fontWeight: '700' }}>
                    A nova regra já está valendo.
                  </Text>
                ) : null}
              </Card>
            )}
          </>
        )}
      </Loaded>
    </>
  );
}
