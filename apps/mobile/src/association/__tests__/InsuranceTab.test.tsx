import * as ImagePicker from 'expo-image-picker';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, uploadFile, ApiError } from '../../api';
import { plain } from '../../testing/fixtures';
import { InsuranceTab } from '../InsuranceTab';
import { bodies, calls, claim, routes } from '../../testing/associationFixtures';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///foto.jpg', mimeType: 'image/jpeg' }],
  })),
}));

beforeEach(() => {
  (api as jest.Mock).mockReset();
  (uploadFile as jest.Mock).mockReset().mockResolvedValue({});
});

describe('seguro mútuo', () => {
  it('lista os pedidos com a situação; sem pedidos, avisa', async () => {
    routes({
      'GET /insurance/claims': [
        claim(),
        claim({ id: 'c2', kind: 'ROUBO_FURTO', status: 'APROVADA' }),
      ],
    });
    await render(<InsuranceTab />);
    expect(await screen.findByText(/Acidente · R\$/)).toBeTruthy();
    expect(screen.getByText('Em análise')).toBeTruthy();
    expect(screen.getByText('Aprovado')).toBeTruthy();
  });

  it('sem pedidos', async () => {
    routes({ 'GET /insurance/claims': [] });
    await render(<InsuranceTab />);
    expect(await screen.findByText('Você ainda não fez nenhum pedido.')).toBeTruthy();
  });

  describe('novo pedido', () => {
    const fill = async (over: { date?: string; text?: string; value?: string } = {}) => {
      await fireEvent.changeText(
        screen.getByLabelText('Quando aconteceu'),
        over.date ?? '20102026',
      );
      await fireEvent.changeText(
        screen.getByLabelText('O que aconteceu'),
        over.text ?? 'Caí da moto na avenida e quebrei a carenagem.',
      );
      await fireEvent.changeText(
        screen.getByLabelText('Valor pedido (R$)'),
        over.value ?? '800,00',
      );
    };
    const start = async (extra: Record<string, unknown> = {}) => {
      routes({ 'GET /insurance/claims': [], ...extra });
      await render(<InsuranceTab />);
      await fireEvent.press(await screen.findByText('Novo pedido de seguro'));
    };

    it('valida data, texto e valor antes de enviar', async () => {
      await start();
      await fireEvent.press(screen.getByText('Enviar pedido'));
      expect(await screen.findByText(/dd\/mm\/aaaa/)).toBeTruthy();
      await fill({ date: '31022026' });
      await fireEvent.press(screen.getByText('Enviar pedido'));
      expect(await screen.findByText(/formato dd\/mm\/aaaa/)).toBeTruthy();
      await fill({ text: 'curto' });
      await fireEvent.press(screen.getByText('Enviar pedido'));
      expect(await screen.findByText(/pelo menos 10 letras/)).toBeTruthy();
      await fill({ value: '' });
      await fireEvent.press(screen.getByText('Enviar pedido'));
      expect(await screen.findByText(/valor que você está pedindo/)).toBeTruthy();
      expect(calls('POST', '/insurance/claims')).toHaveLength(0);
    });

    it('a máscara coloca as barras da data sozinha', async () => {
      await start();
      await fireEvent.changeText(screen.getByLabelText('Quando aconteceu'), '20102026');
      expect(screen.getByLabelText('Quando aconteceu').props.value).toBe('20/10/2026');
    });

    it('envia o pedido e abre o acompanhamento', async () => {
      await start({
        'POST /insurance/claims': claim({
          id: 'novo',
          status: 'ENVIADA',
          timeline: [{ from: null, to: 'ENVIADA', note: null, at: '2026-10-29T12:00:00Z' }],
        }),
        'GET /insurance/claims/novo': claim({
          id: 'novo',
          status: 'ENVIADA',
          timeline: [{ from: null, to: 'ENVIADA', note: null, at: '2026-10-29T12:00:00Z' }],
        }),
      });
      await fill();
      await fireEvent.press(screen.getByText('Enviar pedido'));
      expect(await screen.findByText('Acompanhamento')).toBeTruthy();
      const body = bodies('POST', '/insurance/claims')[0]!;
      expect(body).toMatchObject({ kind: 'ACIDENTE', requestedCents: 80_000 });
      expect(body.occurredAt).toBe('2026-10-20T15:00:00.000Z'); // meio-dia em João Pessoa
    });

    it('escolher o tipo muda o que é enviado', async () => {
      await start({ 'POST /insurance/claims': claim(), 'GET /insurance/claims/c1': claim() });
      await fireEvent.press(screen.getByText('Roubo ou furto'));
      await fill();
      await fireEvent.press(screen.getByText('Enviar pedido'));
      await waitFor(() => expect(bodies('POST', '/insurance/claims')[0]!.kind).toBe('ROUBO_FURTO'));
    });

    it('erro da API aparece (ex.: data no futuro)', async () => {
      await start({
        'POST /insurance/claims': () => {
          throw new ApiError(400, 'A data do ocorrido não pode ser no futuro');
        },
      });
      await fill();
      await fireEvent.press(screen.getByText('Enviar pedido'));
      expect(await screen.findByText('A data do ocorrido não pode ser no futuro')).toBeTruthy();
    });
  });

  describe('acompanhamento', () => {
    const open = async () => {
      await render(<InsuranceTab />);
      await fireEvent.press(await screen.findByLabelText('Pedido Acidente'));
    };

    it('pedido em análise: linha do tempo, anexar foto e cancelar', async () => {
      routes({
        'GET /insurance/claims': [claim()],
        'GET /insurance/claims/c1': claim(),
        'POST /insurance/claims/c1/cancel': claim({ status: 'CANCELADA' }),
      });
      await open();
      expect(await screen.findByText('Acompanhamento')).toBeTruthy();
      expect(screen.getByText(/· Enviado$/)).toBeTruthy();
      expect(screen.getByText(/· Em análise$/)).toBeTruthy();
      await fireEvent.press(screen.getByText('Anexar foto'));
      await waitFor(() =>
        expect(uploadFile).toHaveBeenCalledWith('/insurance/claims/c1/attachments', {
          uri: 'file:///foto.jpg',
          mimeType: 'image/jpeg',
        }),
      );
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
      await fireEvent.press(screen.getByText('Cancelar pedido'));
      await waitFor(() => expect(calls('POST', '/insurance/claims/c1/cancel')).toHaveLength(1));
    });

    it('erro no envio do anexo aparece', async () => {
      routes({ 'GET /insurance/claims': [claim()], 'GET /insurance/claims/c1': claim() });
      (uploadFile as jest.Mock).mockRejectedValue(
        new ApiError(400, 'Formato não suportado. Envie JPG, PNG ou PDF.'),
      );
      await open();
      await fireEvent.press(await screen.findByText('Anexar foto'));
      expect(await screen.findByText('Formato não suportado. Envie JPG, PNG ou PDF.')).toBeTruthy();
    });

    it('galeria cancelada: nada é enviado', async () => {
      routes({ 'GET /insurance/claims': [claim()], 'GET /insurance/claims/c1': claim() });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: true });
      await open();
      await fireEvent.press(await screen.findByText('Anexar foto'));
      await waitFor(() => expect(screen.getByText('Anexar foto')).toBeTruthy());
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it('aprovado: mostra o valor aprovado e o motivo da associação, sem ações', async () => {
      const done = claim({
        status: 'APROVADA',
        approvedCents: 60_000,
        decisionNote: 'Fotos e boletim conferem com o relato.',
        timeline: [
          ...claim().timeline,
          { from: 'EM_ANALISE', to: 'APROVADA', note: 'ok', at: '2026-10-25T15:00:00Z' },
        ],
      });
      routes({ 'GET /insurance/claims': [done], 'GET /insurance/claims/c1': done });
      await open();
      expect(await screen.findByText('Decisão da associação')).toBeTruthy();
      expect(screen.getByText('Fotos e boletim conferem com o relato.')).toBeTruthy();
      expect(plain(screen.getByTestId('approved').props.children)).toBe('R$ 600,00');
      expect(screen.queryByText('Anexar foto')).toBeNull();
      expect(screen.queryByText('Cancelar pedido')).toBeNull();
    });

    it('negado: mostra o motivo e não mostra valor aprovado', async () => {
      const denied = claim({ status: 'NEGADA', decisionNote: 'Fora da cobertura prevista.' });
      routes({ 'GET /insurance/claims': [denied], 'GET /insurance/claims/c1': denied });
      await open();
      expect(await screen.findByText('Fora da cobertura prevista.')).toBeTruthy();
      expect(screen.queryByTestId('approved')).toBeNull();
    });
  });
});
