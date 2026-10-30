/** Conexão WebSocket com reconexão automática. Protocolo do servidor: docs/API.md seção 7. */

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export interface RealtimeOptions {
  url: string;
  getToken: () => string | null;
  /** Chamado quando o servidor recusa o token (4401): renova a sessão antes de reconectar. */
  refreshSession: () => Promise<void>;
  onStatus: (status: RealtimeStatus) => void;
  onEvent: (event: string, data: unknown) => void;
  createSocket?: (url: string) => SocketLike;
}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;

export class RealtimeClient {
  private socket: SocketLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private stopped = true;
  private status: RealtimeStatus = 'closed';

  constructor(private readonly opts: RealtimeOptions) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.socket;
    this.socket = null;
    s?.close();
    this.setStatus('closed');
  }

  /** false se não há conexão aberta (quem chama usa o REST no lugar). */
  sendPosition(lat: number, lng: number): boolean {
    if (this.status !== 'open' || !this.socket) return false;
    this.socket.send(JSON.stringify({ event: 'position', data: { lat, lng } }));
    return true;
  }

  private setStatus(s: RealtimeStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus(s);
  }

  private connect() {
    if (this.stopped) return;
    this.setStatus('connecting');
    const socket = (this.opts.createSocket ?? ((u) => new WebSocket(u) as unknown as SocketLike))(
      this.opts.url,
    );
    this.socket = socket;

    socket.onopen = () => {
      const token = this.opts.getToken();
      if (!token) return socket.close();
      // O token vai na primeira mensagem, não na URL (a URL aparece em logs de acesso).
      socket.send(JSON.stringify({ event: 'auth', data: { token } }));
    };
    socket.onmessage = (e) => {
      let msg: { event?: string; data?: unknown };
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.event === 'auth.ok') {
        this.attempts = 0;
        this.setStatus('open');
      } else if (msg.event && msg.event !== 'position.ok' && msg.event !== 'error') {
        this.opts.onEvent(msg.event, msg.data);
      }
    };
    socket.onerror = () => {}; // o onclose vem logo em seguida e cuida da reconexão
    socket.onclose = (e) => {
      if (this.socket !== socket) return; // conexão antiga, já substituída
      this.socket = null;
      this.setStatus('closed');
      if (this.stopped) return;
      if (e.code === 4401) {
        this.opts.refreshSession().then(
          () => this.schedule(),
          () => this.schedule(),
        );
      } else this.schedule();
    };
  }

  private schedule() {
    if (this.stopped) return;
    const delay = Math.min(BASE_DELAY_MS * 2 ** this.attempts, MAX_DELAY_MS);
    this.attempts++;
    this.timer = setTimeout(() => this.connect(), delay);
  }
}
