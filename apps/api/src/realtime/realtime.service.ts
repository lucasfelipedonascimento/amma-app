import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';

/**
 * Registro das conexões WebSocket autenticadas, por usuário, e envio de eventos.
 * Guarda tudo em memória: com mais de uma instância da API será preciso Redis pub/sub
 * (ver docs/DECISOES.md). O REST sempre devolve o estado atual, então perder um evento
 * só atrasa a tela, nunca o dado.
 */
@Injectable()
export class RealtimeService {
  private readonly sockets = new Map<string, Set<WebSocket>>();

  register(userId: string, socket: WebSocket) {
    const set = this.sockets.get(userId) ?? new Set();
    set.add(socket);
    this.sockets.set(userId, set);
  }

  unregister(socket: WebSocket) {
    for (const [userId, set] of this.sockets) {
      if (set.delete(socket) && set.size === 0) this.sockets.delete(userId);
    }
  }

  /** Mensagem no formato { event, data }, o mesmo que o adaptador `ws` do Nest entende. */
  sendToUser(userId: string, event: string, data: unknown) {
    const payload = JSON.stringify({ event, data });
    for (const socket of this.sockets.get(userId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  /** Quantas conexões abertas o usuário tem. */
  connectionCount(userId: string): number {
    return this.sockets.get(userId)?.size ?? 0;
  }

  connectedUserIds(): string[] {
    return [...this.sockets.keys()];
  }

  /** Fecha todas as conexões do usuário (conta bloqueada, excluída ou que saiu). */
  disconnectUser(userId: string, code = 4401, reason = 'unauthorized') {
    for (const socket of [...(this.sockets.get(userId) ?? [])]) socket.close(code, reason);
    this.sockets.delete(userId);
  }

  isConnected(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }
}
