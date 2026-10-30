import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api } from '../../api';
import { ChatLauncher, DRIVER_QUICK_REPLIES } from '../ChatLauncher';
import type { ChatMessage } from '../useChat';

jest.mock('../../api', () => ({ api: jest.fn() }));
const mockApi = api as unknown as jest.Mock;

const listeners = new Set<(event: string, data: unknown) => void>();
const subscribe = (fn: (event: string, data: unknown) => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const emit = (event: string, data: unknown) => listeners.forEach((fn) => fn(event, data));

const msg = (id: string, body: string, fromMe: boolean, at: string): ChatMessage => ({
  id,
  deliveryId: 'd1',
  body,
  fromMe,
  createdAt: at,
});

const setup = async (history: ChatMessage[] = [], open = true) => {
  mockApi.mockImplementation(async (path: string, opts?: { body?: { body: string } }) => {
    if (opts?.body) return msg('new', opts.body.body, true, '2026-10-30T12:00:10.000Z');
    expect(path).toBe('/deliveries/d1/messages');
    return history;
  });
  await render(
    <ChatLauncher
      deliveryId="d1"
      subscribe={subscribe}
      realtimeOpen
      open={open}
      who="o passageiro"
      quickReplies={DRIVER_QUICK_REPLIES}
    />,
  );
};

beforeEach(() => {
  mockApi.mockReset();
  listeners.clear();
});

describe('chat do pedido', () => {
  it('mostra o histórico e deixa escrever; a mensagem enviada vai para a API', async () => {
    await setup([msg('a', 'Estou na portaria', false, '2026-10-30T12:00:00.000Z')]);
    await fireEvent.press(await screen.findByText(/Chat/));
    expect(await screen.findByText('Estou na portaria')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Mensagem'), '  Já chego  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/deliveries/d1/messages', {
        body: { body: 'Já chego' },
      }),
    );
    expect(await screen.findByText('Já chego')).toBeTruthy();
  });

  it('respostas rápidas enviam na hora', async () => {
    await setup();
    await fireEvent.press(await screen.findByText(/Chat/));
    await fireEvent.press(screen.getByRole('button', { name: 'Cheguei ao local' }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/deliveries/d1/messages', {
        body: { body: 'Cheguei ao local' },
      }),
    );
  });

  it('mensagem do outro lado chega pelo tempo real e acende o contador até abrir', async () => {
    await setup();
    await screen.findByText('💬 Chat');
    await act(async () =>
      emit('chat.message', {
        deliveryId: 'd1',
        message: msg('b', 'Estou no portão azul', false, '2026-10-30T12:01:00.000Z'),
      }),
    );
    expect(screen.getByText('💬 Chat (1)')).toBeTruthy();
    await act(async () =>
      emit('chat.message', {
        deliveryId: 'outro',
        message: msg('c', 'ignorada', false, '2026-10-30T12:02:00.000Z'),
      }),
    );
    expect(screen.getByText('💬 Chat (1)')).toBeTruthy();
    await fireEvent.press(screen.getByText('💬 Chat (1)'));
    expect(await screen.findByText('Estou no portão azul')).toBeTruthy();
    expect(screen.queryByText(/Chat \(/)).toBeNull();
  });

  it('com a corrida encerrada só lê: sem campo de mensagem', async () => {
    await setup([msg('a', 'Oi', false, '2026-10-30T12:00:00.000Z')], false);
    await fireEvent.press(await screen.findByText(/Chat/));
    expect(await screen.findByText('Oi')).toBeTruthy();
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    expect(screen.getByText(/conversa foi encerrada/)).toBeTruthy();
  });
});
