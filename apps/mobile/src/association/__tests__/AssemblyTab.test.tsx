import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, ApiError } from '../../api';
import { AssemblyTab } from '../AssemblyTab';
import { bodies, calls, proposal, routes } from '../../testing/associationFixtures';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});

beforeEach(() => (api as jest.Mock).mockReset());

describe('assembleia', () => {
  it('lista as propostas com situação e o voto de cada uma', async () => {
    routes({
      'GET /assembly/proposals': [
        proposal({ myVote: 'SIM' }),
        proposal({ id: 'p2', title: 'Seguro novo', status: 'APROVADA' }),
      ],
    });
    await render(<AssemblyTab />);
    expect(await screen.findByText('Reajustar a taxa')).toBeTruthy();
    expect(screen.getByText(/Seu voto: Sim/)).toBeTruthy();
    expect(screen.getByText('Aprovada')).toBeTruthy();
    expect(screen.getByText('Votação aberta')).toBeTruthy();
  });

  it('sem propostas', async () => {
    routes({ 'GET /assembly/proposals': [] });
    await render(<AssemblyTab />);
    expect(await screen.findByText(/Nenhuma proposta ainda/)).toBeTruthy();
  });

  it('abre a proposta, vota e vê o voto registrado; depois muda o voto', async () => {
    let mine: 'SIM' | 'NAO' | null = null;
    routes({
      'GET /assembly/proposals': [proposal()],
      'GET /assembly/proposals/p1': () => proposal({ myVote: mine }),
      'PUT /assembly/proposals/p1/vote': (o: { body: { choice: 'SIM' | 'NAO' } }) => {
        mine = o.body.choice;
        return proposal({ myVote: mine });
      },
    });
    await render(<AssemblyTab />);
    await fireEvent.press(await screen.findByLabelText('Reajustar a taxa'));
    await screen.findByText('Seu voto');
    expect(screen.getByText(/A contagem só aparece depois do fechamento/)).toBeTruthy();
    expect(screen.queryByText('Resultado')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Sim'));
    expect(await screen.findByText('Seu voto atual: Sim')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Não'));
    expect(await screen.findByText('Seu voto atual: Não')).toBeTruthy();
    expect(bodies('PUT', '/assembly/proposals/p1/vote')).toEqual([
      { choice: 'SIM' },
      { choice: 'NAO' },
    ]);
  });

  it('votação já encerrada: mostra o erro e recarrega a proposta', async () => {
    let closed = false;
    routes({
      'GET /assembly/proposals': [proposal()],
      'GET /assembly/proposals/p1': () =>
        closed
          ? proposal({
              status: 'APROVADA',
              result: {
                yes: 3,
                no: 1,
                abstain: 0,
                total: 4,
                closedAt: '',
                appliedRulesVersion: null,
              },
            })
          : proposal(),
      'PUT /assembly/proposals/p1/vote': () => {
        closed = true;
        throw new ApiError(409, 'A votação desta proposta já foi encerrada');
      },
    });
    await render(<AssemblyTab />);
    await fireEvent.press(await screen.findByLabelText('Reajustar a taxa'));
    await fireEvent.press(await screen.findByLabelText('Sim'));
    expect(await screen.findByText('Resultado')).toBeTruthy();
    expect(screen.queryByLabelText('Sim')).toBeNull(); // não dá mais para votar
  });

  it('proposta encerrada mostra o resultado, o seu voto e nenhum botão de voto', async () => {
    routes({
      'GET /assembly/proposals': [proposal({ status: 'APROVADA' })],
      'GET /assembly/proposals/p1': proposal({
        status: 'APROVADA',
        myVote: 'NAO',
        quorumPercent: 20,
        requiredVotes: 2,
        result: { yes: 6, no: 2, abstain: 1, total: 9, closedAt: '', appliedRulesVersion: 'v1' },
      }),
    });
    await render(<AssemblyTab />);
    await fireEvent.press(await screen.findByLabelText('Reajustar a taxa'));
    expect(await screen.findByText('Resultado')).toBeTruthy();
    expect(screen.getByText('Seu voto: Não')).toBeTruthy();
    expect(screen.getByText(/9 de 10 sócios votaram \(mínimo 2\)/)).toBeTruthy();
    expect(screen.getByText('A nova regra já está valendo.')).toBeTruthy();
    expect(screen.queryByLabelText('Sim')).toBeNull();
  });

  it('proposta de regra mostra o que está sendo proposto', async () => {
    routes({
      'GET /assembly/proposals': [proposal({ kind: 'REGRA_COMPRA_COLETIVA' })],
      'GET /assembly/proposals/p1': proposal({
        kind: 'REGRA_COMPRA_COLETIVA',
        ruleChange: { minQuotas: 5, dayWeight: 3 },
      }),
    });
    await render(<AssemblyTab />);
    await fireEvent.press(await screen.findByLabelText('Reajustar a taxa'));
    expect(await screen.findByText('Regra proposta')).toBeTruthy();
    expect(screen.getByText('Mínimo de cotas para entrar')).toBeTruthy();
    expect(screen.getByText('Pontos por dia de fila')).toBeTruthy();
  });

  it('não sócio: a API recusa e a mensagem aparece', async () => {
    routes({
      'GET /assembly/proposals': [proposal()],
      'GET /assembly/proposals/p1': proposal(),
      'PUT /assembly/proposals/p1/vote': () => {
        throw new ApiError(403, 'Só sócios (com ao menos 1 cota) podem votar');
      },
    });
    await render(<AssemblyTab />);
    await fireEvent.press(await screen.findByLabelText('Reajustar a taxa'));
    await fireEvent.press(await screen.findByLabelText('Abstenção'));
    expect(await screen.findByText('Só sócios (com ao menos 1 cota) podem votar')).toBeTruthy();
  });

  it('voltar leva à lista e recarrega', async () => {
    routes({ 'GET /assembly/proposals': [proposal()], 'GET /assembly/proposals/p1': proposal() });
    await render(<AssemblyTab />);
    await fireEvent.press(await screen.findByLabelText('Reajustar a taxa'));
    await screen.findByText('Seu voto');
    await fireEvent.press(screen.getByLabelText('‹ Voltar'));
    await waitFor(() => expect(calls('GET', '/assembly/proposals')).toHaveLength(2));
    expect(await screen.findByLabelText('Reajustar a taxa')).toBeTruthy();
  });
});
