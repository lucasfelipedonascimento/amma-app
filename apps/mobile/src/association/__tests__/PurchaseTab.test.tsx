import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, ApiError } from '../../api';
import { plain } from '../../testing/fixtures';
import { PurchaseTab } from '../PurchaseTab';
import { bodies, calls, groupDetail, groupItem, routes } from '../../testing/associationFixtures';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});

beforeEach(() => (api as jest.Mock).mockReset());

const mineEmpty = { totalCents: 0, items: [] };
const open = async () => {
  await render(<PurchaseTab />);
  await fireEvent.press(await screen.findByLabelText('Motos 2027'));
};

describe('compra coletiva', () => {
  it('lista os grupos com a sua situação', async () => {
    routes({
      'GET /purchase-groups': [
        groupItem({ myStatus: 'NA_FILA' }),
        groupItem({ id: 'g2', name: 'Carros', status: 'ENCERRADO' }),
      ],
    });
    await render(<PurchaseTab />);
    expect(await screen.findByText('Motos 2027')).toBeTruthy();
    expect(screen.getByText('Você está na fila')).toBeTruthy();
    expect(screen.getByText('Encerrado')).toBeTruthy();
  });

  it('sem grupos', async () => {
    routes({ 'GET /purchase-groups': [] });
    await render(<PurchaseTab />);
    expect(await screen.findByText(/Nenhum grupo de compra aberto/)).toBeTruthy();
  });

  it('detalhe: fila ordenada, sua posição e a regra de pontos; sem aportes antes de entrar', async () => {
    routes({
      'GET /purchase-groups': [groupItem()],
      'GET /purchase-groups/g1': groupDetail(),
      'GET /purchase-groups/g1/contributions': mineEmpty,
    });
    await open();
    expect(await screen.findByText('1º Bruno')).toBeTruthy();
    expect(screen.getByText('2º Ana (você)')).toBeTruthy();
    expect(screen.getByText('Você: 10 cotas e 5 dia(s) de fila.')).toBeTruthy();
    expect(screen.getByText(/10 por cota \+ 1 por dia de fila/)).toBeTruthy();
    expect(screen.getByText('Entrar na fila')).toBeTruthy();
    expect(screen.queryByText('Meus aportes')).toBeNull();
  });

  it('entrar na fila chama a API e recarrega', async () => {
    let status: 'NA_FILA' | null = null;
    routes({
      'GET /purchase-groups': [groupItem()],
      'GET /purchase-groups/g1': () => groupDetail({ myStatus: status }),
      'GET /purchase-groups/g1/contributions': mineEmpty,
      'POST /purchase-groups/g1/join': () => {
        status = 'NA_FILA';
        return {};
      },
    });
    await open();
    await fireEvent.press(await screen.findByText('Entrar na fila'));
    expect(await screen.findByText('Sair da fila')).toBeTruthy();
    expect(screen.getByText('Meus aportes')).toBeTruthy();
  });

  it('sem cotas suficientes: a mensagem da API aparece', async () => {
    routes({
      'GET /purchase-groups': [groupItem()],
      'GET /purchase-groups/g1': groupDetail(),
      'GET /purchase-groups/g1/contributions': mineEmpty,
      'POST /purchase-groups/g1/join': () => {
        throw new ApiError(
          403,
          'Para entrar nesta fila é preciso ter ao menos 5 cota(s). Você tem 2.',
        );
      },
    });
    await open();
    await fireEvent.press(await screen.findByText('Entrar na fila'));
    expect(await screen.findByText(/preciso ter ao menos 5 cota/)).toBeTruthy();
  });

  it('com aportes na fila: mostra o total, valida o valor e manda a mesma chave em nova tentativa', async () => {
    let attempt = 0;
    routes({
      'GET /purchase-groups': [groupItem()],
      'GET /purchase-groups/g1': groupDetail({ myStatus: 'NA_FILA' }),
      'GET /purchase-groups/g1/contributions': {
        totalCents: 10_000,
        items: [
          {
            id: 'k1',
            amountCents: 10_000,
            status: 'CONFIRMADO',
            declineReason: null,
            instructions: null,
            partner: 'sandbox',
            createdAt: '',
          },
        ],
      },
      'POST /purchase-groups/g1/contributions': () => {
        if (++attempt === 1)
          throw new ApiError(
            503,
            'O parceiro está indisponível. Nada foi registrado; tente de novo.',
          );
        return {
          id: 'k2',
          amountCents: 20_000,
          status: 'CONFIRMADO',
          declineReason: null,
          instructions: null,
          partner: 'sandbox',
          createdAt: '',
        };
      },
    });
    await open();
    await screen.findByText('Meus aportes');
    expect(plain(screen.getByTestId('my-total').props.children)).toBe('R$ 100,00');
    expect(screen.getByText(/SIMULAÇÃO: nenhum dinheiro é movimentado/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Registrar aporte'));
    expect(await screen.findByText('Digite o valor do aporte em reais.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Valor do aporte (R$)'), '10');
    await fireEvent.press(screen.getByText('Registrar aporte'));
    expect(await screen.findByText(/O aporte mínimo é R\$.50,00/)).toBeTruthy();
    expect(calls('POST', '/purchase-groups/g1/contributions')).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('Valor do aporte (R$)'), '200,00');
    await fireEvent.press(screen.getByText('Registrar aporte'));
    expect(await screen.findByText(/parceiro está indisponível/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Registrar aporte'));
    expect(await screen.findByText('Aporte registrado.')).toBeTruthy();

    const sent = bodies('POST', '/purchase-groups/g1/contributions');
    expect(sent).toHaveLength(2);
    expect(sent[0].amountCents).toBe(20_000);
    expect(sent[1].idempotencyKey).toBe(sent[0].idempotencyKey); // nova tentativa = mesmo aporte
    expect(sent[0].idempotencyKey).toMatch(/^[\w-]{8,64}$/);
  });

  it('o parceiro recusou: o aviso explica o motivo', async () => {
    routes({
      'GET /purchase-groups': [groupItem()],
      'GET /purchase-groups/g1': groupDetail({ myStatus: 'NA_FILA' }),
      'GET /purchase-groups/g1/contributions': mineEmpty,
      'POST /purchase-groups/g1/contributions': {
        id: 'k',
        amountCents: 2_000_000,
        status: 'RECUSADO',
        declineReason: 'Valor acima do limite do parceiro',
        instructions: null,
        partner: 'sandbox',
        createdAt: '',
      },
    });
    await open();
    await fireEvent.changeText(await screen.findByLabelText('Valor do aporte (R$)'), '20000');
    await fireEvent.press(screen.getByText('Registrar aporte'));
    expect(
      await screen.findByText(/O parceiro recusou o aporte: Valor acima do limite do parceiro/),
    ).toBeTruthy();
  });

  it('aporte pendente: o aviso diz o que falta pagar e a lista mostra "Aguardando o parceiro"', async () => {
    routes({
      'GET /purchase-groups': [groupItem()],
      'GET /purchase-groups/g1': groupDetail({ myStatus: 'NA_FILA' }),
      'GET /purchase-groups/g1/contributions': mineEmpty,
      'POST /purchase-groups/g1/contributions': {
        id: 'k',
        amountCents: 5_000,
        status: 'PENDENTE',
        declineReason: null,
        instructions: 'PIX-DO-PARCEIRO',
        partner: 'sandbox',
        createdAt: '',
      },
    });
    await open();
    await fireEvent.changeText(await screen.findByLabelText('Valor do aporte (R$)'), '50');
    await fireEvent.press(screen.getByText('Registrar aporte'));
    expect(await screen.findByText(/Falta pagar ao parceiro: PIX-DO-PARCEIRO/)).toBeTruthy();
  });

  it('sair da fila; contemplado não tem botão de entrar nem de sair', async () => {
    routes({
      'GET /purchase-groups': [groupItem()],
      'GET /purchase-groups/g1': groupDetail({
        myStatus: 'CONTEMPLADO',
        awards: [{ position: 1, name: 'Ana', awardedAt: '', isMe: true }],
      }),
      'GET /purchase-groups/g1/contributions': mineEmpty,
    });
    await open();
    expect(await screen.findByText('Contemplado: Ana (você)')).toBeTruthy();
    expect(screen.queryByText('Sair da fila')).toBeNull();
    expect(screen.queryByText('Entrar na fila')).toBeNull();
  });

  it('grupo encerrado não aceita entrada nem aporte', async () => {
    routes({
      'GET /purchase-groups': [groupItem()],
      'GET /purchase-groups/g1': groupDetail({ status: 'ENCERRADO', myStatus: 'NA_FILA' }),
      'GET /purchase-groups/g1/contributions': mineEmpty,
    });
    await open();
    await screen.findByText('Meus aportes');
    expect(screen.queryByText('Sair da fila')).toBeNull();
    expect(screen.queryByText('Registrar aporte')).toBeNull();
  });

  it('sair da fila chama a API', async () => {
    routes({
      'GET /purchase-groups': [groupItem()],
      'GET /purchase-groups/g1': groupDetail({ myStatus: 'NA_FILA' }),
      'GET /purchase-groups/g1/contributions': mineEmpty,
      'POST /purchase-groups/g1/leave': {},
    });
    await open();
    await fireEvent.press(await screen.findByText('Sair da fila'));
    await waitFor(() => expect(calls('POST', '/purchase-groups/g1/leave')).toHaveLength(1));
  });
});
