import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
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
import { parseCorsOrigins } from '../common/cors';
import { RateLimitService } from '../common/rate-limit';
import { PrismaService } from '../prisma.service';
import { DeliveryService } from '../delivery/delivery.service';
import { RealtimeService } from './realtime.service';

/** Quem conecta tem este tempo para enviar { event: "auth" }; senão a conexão é fechada. */
export const WS_AUTH_TIMEOUT_MS = 5000;
/** Posições mais frequentes que isso são descartadas (proteção contra app com defeito). */
export const WS_MIN_POSITION_INTERVAL_MS = 1000;
/** Conexões autenticadas simultâneas por usuário (celular + uma reconexão + reserva). */
export const WS_MAX_CONNECTIONS_PER_USER = 3;
/** Conexões novas por IP por minuto. */
export const WS_CONNECTS_PER_MINUTE = 120;
/** De quanto em quanto tempo as conexões abertas são revalidadas (bloqueio, exclusão, logout). */
export const WS_REVALIDATE_DEFAULT_MS = 60_000;

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
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('WS');
  private sweep?: NodeJS.Timeout;

  constructor(
    private readonly auth: AuthGuard,
    private readonly realtime: RealtimeService,
    private readonly deliveries: DeliveryService,
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimitService,
    private readonly config: ConfigService,
  ) {}

  /**
   * O token só é conferido no `auth`; sem isto a conexão sobreviveria a um bloqueio, à exclusão da
   * conta ou ao "sair de todos os aparelhos". A cada ciclo, quem não tem mais sessão válida cai.
   */
  onModuleInit() {
    const every = Number(this.config.get('WS_REVALIDATE_MS') ?? WS_REVALIDATE_DEFAULT_MS);
    if (every > 0) {
      this.sweep = setInterval(() => void this.revalidate().catch(() => undefined), every);
      this.sweep.unref();
    }
  }

  onModuleDestroy() {
    clearInterval(this.sweep);
  }

  async revalidate() {
    const ids = this.realtime.connectedUserIds();
    if (ids.length === 0) return;
    const [users, sessions] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids }, deletedAt: null, blockedAt: null },
        select: { id: true },
      }),
      this.prisma.refreshToken.findMany({
        where: { userId: { in: ids }, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);
    const valid = new Set(users.map((u) => u.id));
    const active = new Set(sessions.map((s) => s.userId));
    for (const id of ids)
      if (!valid.has(id) || !active.has(id)) {
        this.logger.log('Conexão encerrada: conta sem sessão válida');
        this.realtime.disconnectUser(id);
      }
  }

  async handleConnection(client: Client, req?: IncomingMessage) {
    // Navegador de outro site não deve abrir o socket (o app nativo não envia Origin).
    const origin = req?.headers.origin;
    if (origin && !parseCorsOrigins(this.config.get('CORS_ORIGINS')).includes(origin)) {
      client.close(4403, 'origin');
      return;
    }
    if (
      await this.limiter.hit('ws-connect', this.ipOf(req), {
        limit: WS_CONNECTS_PER_MINUTE,
        windowSeconds: 60,
      })
    ) {
      client.close(4429, 'rate');
      return;
    }
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
      if (client.user.blocked) throw new Error('conta bloqueada');
    } catch {
      client.close(4401, 'unauthorized');
      return;
    }
    if (this.realtime.connectionCount(client.user.id) >= WS_MAX_CONNECTIONS_PER_USER) {
      client.close(4429, 'too many connections');
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

  /** IP do cliente; atrás de proxy (`TRUST_PROXY`), o inserido pelo último proxy confiável. */
  private ipOf(req?: IncomingMessage): string {
    const trust = Number(this.config.get('TRUST_PROXY') ?? 0);
    const forwarded = req?.headers['x-forwarded-for'];
    if (trust > 0 && typeof forwarded === 'string') {
      const hops = forwarded.split(',').map((h) => h.trim());
      return hops[Math.max(0, hops.length - trust)] ?? 'unknown';
    }
    return req?.socket.remoteAddress ?? 'unknown';
  }
}
