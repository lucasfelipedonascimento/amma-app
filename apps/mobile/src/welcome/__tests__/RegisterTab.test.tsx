import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { HOUSE_CHECKLIST } from '@amma/shared';
import { api, ApiError } from '../../api';
import { point, sent, welcomeRoutes } from '../../testing/welcomeFixtures';
import { RegisterTab } from '../RegisterTab';

jest.mock('../../api', () => {
  const actual = jest.requireActual('../../api');
  return { ...actual, api: jest.fn(), uploadFile: jest.fn() };
});

beforeEach(() => (api as jest.Mock).mockReset());

const type = (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);

/** Preenche o que todo tipo de ponto pede, menos o tipo e o checklist. */
async function fillCommon() {
  await type('Nome do ponto', 'Padaria Boa Hora');
  await type('Endereço', 'Rua das Flores, 100');
  await type('Bairro', 'Manaíra');
  await fireEvent.press(screen.getByText('Usar a minha localização agora'));
  await screen.findByText('Posição marcada.');
  await fireEvent.press(screen.getByText('Água'));
}

describe('cadastro de ponto', () => {
  it('valida os campos antes de chamar a API, um de cada vez', async () => {
    welcomeRoutes([['POST /welcome-points', point()]]);
    await render(<RegisterTab onDone={jest.fn()} />);
    await fireEvent.press(screen.getByText('Cadastrar ponto'));
    expect(screen.getByText('Escolha o tipo de ponto.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Comércio'));
    await fireEvent.press(screen.getByText('Cadastrar ponto'));
    expect(screen.getByText('Dê um nome ao ponto (ao menos 3 letras).')).toBeTruthy();
    await type('Nome do ponto', 'Padaria');
    await fireEvent.press(screen.getByText('Cadastrar ponto'));
    expect(screen.getByText('Informe o endereço e o bairro.')).toBeTruthy();
    await type('Endereço', 'Rua das Flores, 100');
    await type('Bairro', 'Manaíra');
    await fireEvent.press(screen.getByText('Cadastrar ponto'));
    expect(screen.getByText(/Marque a posição/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Usar a minha localização agora'));
    await screen.findByText('Posição marcada.');
    await fireEvent.press(screen.getByText('Cadastrar ponto'));
    expect(screen.getByText('Marque ao menos uma comodidade.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Água'));
    await type('Quantas pessoas cabem ao mesmo tempo', '0');
    await fireEvent.press(screen.getByText('Cadastrar ponto'));
    expect(screen.getByText('A capacidade deve ser de 1 a 50 pessoas.')).toBeTruthy();
    expect(sent('POST', '/welcome-points')).toHaveLength(0);
  });

  it('comércio: envia posição, horário, comodidades e capacidade, e publica', async () => {
    const onDone = jest.fn();
    welcomeRoutes([['POST /welcome-points', point({ status: 'ATIVO' })]]);
    await render(<RegisterTab onDone={onDone} />);
    await fireEvent.press(screen.getByText('Comércio'));
    await fillCommon();
    await fireEvent.press(screen.getByText('Seg a sex, 8h–18h'));
    await fireEvent.press(screen.getByText('Carregador'));
    await type('Quantas pessoas cabem ao mesmo tempo', '6');
    expect(screen.queryByText('Checklist de segurança')).toBeNull();
    await fireEvent.press(screen.getByText('Cadastrar ponto'));
    expect(await screen.findByText('Ponto publicado')).toBeTruthy();
    expect(sent('POST', '/welcome-points')[0]).toEqual({
      type: 'COMERCIO',
      name: 'Padaria Boa Hora',
      address: 'Rua das Flores, 100',
      neighborhood: 'Manaíra',
      lat: -7.115,
      lng: -34.861,
      hours: { always: false, slots: [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '18:00' }] },
      amenities: ['AGUA', 'CARREGADOR'],
      capacity: 6,
    });
    await fireEvent.press(screen.getByText('Ver meus pontos'));
    expect(onDone).toHaveBeenCalled();
  });

  it('casa parceira: exige o checklist inteiro, manda o benefício e vai para a análise', async () => {
    welcomeRoutes([
      ['POST /welcome-points', point({ type: 'CASA_PARCEIRA', status: 'EM_ANALISE' })],
    ]);
    await render(<RegisterTab onDone={jest.fn()} />);
    await fireEvent.press(screen.getByText('Casa parceira'));
    expect(screen.getByText('Checklist de segurança')).toBeTruthy();
    await fillCommon();
    for (const item of HOUSE_CHECKLIST.slice(0, -1))
      await fireEvent.press(screen.getByLabelText(item.text));
    await fireEvent.press(screen.getByText('Enviar para análise'));
    expect(screen.getByText('Confirme todos os itens do checklist de segurança.')).toBeTruthy();
    expect(sent('POST', '/welcome-points')).toHaveLength(0);
    await fireEvent.press(screen.getByLabelText(HOUSE_CHECKLIST.at(-1)!.text));
    await fireEvent.press(screen.getByText('Desconto nas taxas'));
    await fireEvent.press(screen.getByText('Enviar para análise'));
    expect(await screen.findByText('Enviado para análise')).toBeTruthy();
    const body = sent('POST', '/welcome-points')[0]!;
    expect(body.type).toBe('CASA_PARCEIRA');
    expect(body.benefitKind).toBe('DESCONTO');
    expect(Object.keys(body.checklist as object).sort()).toEqual(
      HOUSE_CHECKLIST.map((i) => i.key).sort(),
    );
  });

  it('busca a posição pelo endereço digitado', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValueOnce([
      { latitude: -7.2, longitude: -34.9 },
    ]);
    welcomeRoutes([['POST /welcome-points', point()]]);
    await render(<RegisterTab onDone={jest.fn()} />);
    await fireEvent.press(screen.getByText('Comércio'));
    await type('Endereço', 'Rua Nova, 5');
    await fireEvent.press(screen.getByText('Buscar pelo endereço'));
    expect(await screen.findByText('Posição marcada.')).toBeTruthy();
    expect(Location.geocodeAsync).toHaveBeenCalledWith('Rua Nova, 5, João Pessoa - PB');
  });

  it('endereço que não existe e localização negada mostram o motivo', async () => {
    (Location.geocodeAsync as jest.Mock).mockResolvedValueOnce([]);
    await render(<RegisterTab onDone={jest.fn()} />);
    await type('Endereço', 'Rua Inexistente, 0');
    await fireEvent.press(screen.getByText('Buscar pelo endereço'));
    expect(await screen.findByText(/Não encontramos esse endereço/)).toBeTruthy();
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
    });
    await fireEvent.press(screen.getByText('Usar a minha localização agora'));
    expect(await screen.findByText(/Não conseguimos pegar a sua localização/)).toBeTruthy();
  });

  it('mostra o erro da API (ex.: ponto repetido) e deixa tentar de novo', async () => {
    welcomeRoutes([
      [
        'POST /welcome-points',
        () => {
          throw new ApiError(409, 'Já existe um ponto deste tipo neste local');
        },
      ],
    ]);
    await render(<RegisterTab onDone={jest.fn()} />);
    await fireEvent.press(screen.getByText('Comércio'));
    await fillCommon();
    await fireEvent.press(screen.getByText('Cadastrar ponto'));
    expect(await screen.findByText('Já existe um ponto deste tipo neste local')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Cadastrar ponto')).toBeTruthy());
  });
});
