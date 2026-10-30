import { RealtimeClient, RealtimeStatus, SocketLike } from '../realtime';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
  // ajudantes de teste
  open() {
    this.onopen?.();
  }
  receive(event: string, data?: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

function setup(token: string | null = 'tok') {
  FakeSocket.all = [];
  const statuses: RealtimeStatus[] = [];
  const events: [string, unknown][] = [];
  const refreshSession = jest.fn(async () => undefined);
  const client = new RealtimeClient({
    url: 'ws://x/ws',
    getToken: () => token,
    refreshSession,
    onStatus: (s) => statuses.push(s),
    onEvent: (e, d) => events.push([e, d]),
    createSocket: (u) => new FakeSocket(u),
  });
  return { client, statuses, events, refreshSession, last: () => FakeSocket.all.at(-1)! };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('RealtimeClient', () => {
  it('autentica na primeira mensagem (token fora da URL) e fica aberto no auth.ok', () => {
    const { client, statuses, last } = setup();
    client.start();
    expect(last().url).toBe('ws://x/ws');
    expect(last().url).not.toContain('tok');
    last().open();
    expect(JSON.parse(last().sent[0]!)).toEqual({ event: 'auth', data: { token: 'tok' } });
    expect(statuses).toEqual(['connecting']);
    last().receive('auth.ok');
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('repassa eventos do servidor e ignora confirmações', () => {
    const { client, events, last } = setup();
    client.start();
    last().open();
    last().receive('auth.ok');
    last().receive('position.ok');
    last().receive('offer.created', { id: 'o1' });
    expect(events).toEqual([['offer.created', { id: 'o1' }]]);
  });

  it('envia posição só com a conexão aberta', () => {
    const { client, last } = setup();
    client.start();
    expect(client.sendPosition(1, 2)).toBe(false);
    last().open();
    last().receive('auth.ok');
    expect(client.sendPosition(-7.1, -34.8)).toBe(true);
    expect(JSON.parse(last().sent.at(-1)!)).toEqual({
      event: 'position',
      data: { lat: -7.1, lng: -34.8 },
    });
  });

  it('reconecta com espera crescente e zera a espera ao autenticar', () => {
    const { client, last } = setup();
    client.start();
    last().drop();
    expect(FakeSocket.all).toHaveLength(1);
    jest.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);
    last().drop();
    jest.advanceTimersByTime(1999);
    expect(FakeSocket.all).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    last().open();
    last().receive('auth.ok');
    last().drop();
    jest.advanceTimersByTime(1000); // voltou a 1 s
    expect(FakeSocket.all).toHaveLength(4);
  });

  it('a espera para de crescer em 15 s', () => {
    const { client, last } = setup();
    client.start();
    for (let i = 0; i < 8; i++) {
      last().drop();
      jest.advanceTimersByTime(15_000);
    }
    const before = FakeSocket.all.length;
    last().drop();
    jest.advanceTimersByTime(14_999);
    expect(FakeSocket.all).toHaveLength(before);
    jest.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(before + 1);
  });

  it('token recusado (4401): renova a sessão antes de reconectar', async () => {
    const { client, refreshSession, last } = setup();
    client.start();
    last().drop(4401);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('sem token fecha a conexão em vez de autenticar com nada', () => {
    const { client, last } = setup(null);
    client.start();
    last().open();
    expect(last().sent).toEqual([]);
    expect(last().closed).toBe(true);
  });

  it('stop() fecha, avisa e não reconecta', () => {
    const { client, statuses, last } = setup();
    client.start();
    const s = last();
    client.stop();
    expect(s.closed).toBe(true);
    expect(statuses.at(-1)).toBe('closed');
    s.drop();
    jest.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('mensagem que não é JSON não derruba a conexão', () => {
    const { client, events, last } = setup();
    client.start();
    last().open();
    expect(() => last().onmessage?.({ data: 'lixo' })).not.toThrow();
    expect(events).toEqual([]);
  });
});
