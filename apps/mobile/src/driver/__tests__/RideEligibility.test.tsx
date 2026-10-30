import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiError, api } from '../../api';
import { RideEligibilityCard } from '../components/RideEligibilityCard';
import type { RideEligibility } from '../types';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});
const mockApi = api as jest.Mock;

beforeEach(() => mockApi.mockReset());

describe('habilitação para corridas (Conta)', () => {
  const base: RideEligibility = {
    rulesVersion: 'padrao-nao-confirmado',
    rulesAreDefault: true,
    warning: 'Valores padrão NÃO confirmados: a associação precisa publicar as regras vigentes.',
    gender: null,
    womenDriverVerified: false,
    vehicles: [
      {
        id: 'v1',
        plate: 'ABC1D23',
        model: 'Onix',
        year: 2022,
        type: 'CARRO',
        eligible: true,
        problems: [],
        documentsToSend: [],
      },
      {
        id: 'v2',
        plate: 'XYZ9K88',
        model: 'CG 160',
        year: 2012,
        type: 'MOTO',
        eligible: false,
        problems: ['CATEGORIA_DESLIGADA', 'VEICULO_MUITO_VELHO', 'DOCUMENTO_FALTANDO'],
        documentsToSend: ['LICENCA_MUNICIPAL'],
      },
    ],
  };
  let data: RideEligibility;
  beforeEach(() => {
    data = base;
    mockApi.mockImplementation(async (path: string, opts?: { body?: { gender: string } }) => {
      if (path === '/driver/ride-eligibility') return data;
      if (path === '/driver/gender') {
        data = { ...data, gender: opts!.body!.gender as RideEligibility['gender'] };
        return { gender: data.gender, verified: false };
      }
      throw new ApiError(404, path);
    });
  });

  it('mostra o aviso de regras não confirmadas, o que está certo e o que falta em cada veículo', async () => {
    await render(<RideEligibilityCard />);
    await new Promise((r) => setTimeout(r, 100));
    console.log(JSON.stringify(screen.toJSON()).slice(0, 600), mockApi.mock.calls);
    expect(await screen.findByText(/NÃO confirmados/)).toBeTruthy();
    expect(screen.getByText('Habilitado para corridas')).toBeTruthy();
    expect(screen.getByText(/Este tipo de corrida não está liberado/)).toBeTruthy();
    expect(screen.getByText(/O veículo passa da idade máxima/)).toBeTruthy();
    expect(screen.getByText(/Falta enviar um documento/)).toBeTruthy();
    expect(screen.getByText('Enviar: Licença municipal')).toBeTruthy();
  });

  it('o botão de enviar abre o envio só dos documentos que faltam', async () => {
    await render(<RideEligibilityCard />);
    await fireEvent.press(await screen.findByText('Enviar: Licença municipal'));
    expect(screen.getByText('Licença municipal')).toBeTruthy();
    expect(screen.queryByText('CNH (frente e verso legíveis)')).toBeNull();
    await fireEvent.press(screen.getByText('Voltar'));
    expect(await screen.findByText('Corridas de passageiro')).toBeTruthy();
  });

  it('declara o gênero e avisa que falta a conferência da associação', async () => {
    await render(<RideEligibilityCard />);
    await fireEvent.press(await screen.findByText('Feminino'));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/driver/gender', {
        method: 'PUT',
        body: { gender: 'FEMININO' },
      }),
    );
    expect(await screen.findByText('Aguardando a conferência da associação.')).toBeTruthy();
  });

  it('verificada pela associação aparece como conferida', async () => {
    data = { ...base, gender: 'FEMININO', womenDriverVerified: true };
    await render(<RideEligibilityCard />);
    expect(await screen.findByText('Conferido pela associação ✓')).toBeTruthy();
  });

  it('falha ao carregar mostra o erro em vez de travar', async () => {
    mockApi.mockRejectedValue(new ApiError(500, 'Erro no servidor'));
    await render(<RideEligibilityCard />);
    expect(await screen.findByText('Erro no servidor')).toBeTruthy();
  });
});
