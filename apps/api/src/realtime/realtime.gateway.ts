import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { isValidPoint } from '@amma/shared';
import type { WebSocket } from 'ws';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { DeliveryService } from '../delivery/delivery.service';
import { RealtimeService } from './realtime.service';

/** Quem conecta tem este tempo para enviar { event: "auth" }; senão a conexão é fechada. */
export const WS_AUTH_TIMEOUT_MS = 5000;
/** Posições mais frequentes que isso são descartadas (proteção contra app com defeito). */
export const WS_MIN_POSITION_INTERVAL_MS = 1000;

type Client = WebSocket & { user?: AuthUser; lastPositionAt?: number; authTimer?: NodeJS.Timeout };
type Reply = { event: string; data?: unknown };

const error = (code: string, message: string): Reply => ({
  event: 'error',
  data: { code, message },
});

/**
 * WebSocket em /ws. Protocolo (JSON { event, data }):
 *   cliente → { event: "auth", data: { token } }                       resposta: auth.ok
 *   motorista → { event: "position", data: { lat, lng } }              (só online)
 *   servidor → offer.created | offer.closed | delivery.updated | driver.position
 * O token vai na primeira mensagem (e não na URL) para não aparecer em logs de acesso.
 */
@WebSocketGateway({ path: '/ws', maxPayload: 4096 })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly auth: AuthGuard,
    private readonly realtime: RealtimeService,
    private readonly deliveries: DeliveryService,
  ) {}

  handleConnection(client: Client) {
    client.authTimer = setTimeout(() => {
      if (!client.user) client.close(4401, 'auth timeout');
    }, WS_AUTH_TIMEOUT_MS);
  }

  handleDisconnect(client: Client) {
    clearTimeout(client.authTimer);
    this.realtime.unregister(client);
  }

  @SubscribeMessage('auth')
  async onAuth(@ConnectedSocket() client: Client, @MessageBody() body: { token?: unknown }) {
    if (typeof body?.token !== 'string') return error('BAD_REQUEST', 'token ausente');
    try {
      client.user = await this.auth.authenticate(body.token);
    } catch {
      client.close(4401, 'unauthorized');
      return;
    }
    clearTimeout(client.authTimer);
    this.realtime.register(client.user.id, client);
    return { event: 'auth.ok', data: { userId: client.user.id, roles: client.user.roles } };
  }

  @SubscribeMessage('position')
  async onPosition(@ConnectedSocket() client: Client, @MessageBody() body: unknown) {
    if (!client.user) return error('UNAUTHENTICATED', 'envie auth primeiro');
    if (!client.user.roles.includes('MOTORISTA')) return error('FORBIDDEN', 'só motoristas');
    if (!isValidPoint(body)) return error('BAD_REQUEST', 'lat/lng inválidos');
    const now = Date.now();
    if (client.lastPositionAt && now - client.lastPositionAt < WS_MIN_POSITION_INTERVAL_MS) return; // descarta em silêncio
    client.lastPositionAt = now;
    const { lat, lng } = body;
    const accepted = await this.deliveries.reportDriverPosition(client.user.id, { lat, lng });
    if (!accepted) return error('OFFLINE', 'fique online antes de enviar posição');
    return { event: 'position.ok' };
  }
}
