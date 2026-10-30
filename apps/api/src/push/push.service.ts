import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatBRL } from '@amma/shared';
import { PrismaService } from '../prisma.service';

export interface PushMessage {
  title: string;
  body: string;
  /** Dados para o app decidir o que abrir. Nada sensível (aparece na tela bloqueada). */
  data?: Record<string, unknown>;
  ttlSeconds?: number;
}

export interface PushSender {
  /** Devolve os tokens que o serviço de push disse não existirem mais (app desinstalado). */
  send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Formato dos tokens do Expo: ExponentPushToken[...] ou ExpoPushToken[...]. */
export const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[\w-]{10,}\]$/;

/** Canal Android das ofertas (criado no app com o mesmo id; define som e importância). */
export const OFFER_CHANNEL_ID = 'offers';

/** Versão simulada (desenvolvimento e testes): só registra, não envia nada. */
export class SimulatedPushSender implements PushSender {
  /** Últimas mensagens "enviadas", para conferir nos testes. */
  readonly outbox: { tokens: string[]; message: PushMessage }[] = [];

  async send(tokens: string[], message: PushMessage) {
    this.outbox.push({ tokens, message });
    if (this.outbox.length > 50) this.outbox.shift();
    new Logger('Push').log(`(simulado) "${message.title}" para ${tokens.length} aparelho(s)`);
    return { invalidTokens: [] };
  }
}

/** Serviço de push do Expo (https://docs.expo.dev/push-notifications/sending-notifications/). */
export class ExpoPushSender implements PushSender {
  static readonly URL = 'https://exp.host/--/api/v2/push/send';
  /** O Expo aceita até 100 mensagens por requisição. */
  static readonly CHUNK = 100;

  constructor(
    private readonly accessToken?: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  async send(tokens: string[], message: PushMessage) {
    const invalidTokens: string[] = [];
    for (let i = 0; i < tokens.length; i += ExpoPushSender.CHUNK) {
      const chunk = tokens.slice(i, i + ExpoPushSender.CHUNK);
      const res = await this.fetchFn(ExpoPushSender.URL, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'content-type': 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(
          chunk.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data,
            sound: 'default',
            priority: 'high',
            channelId: OFFER_CHANNEL_ID,
            ttl: message.ttlSeconds,
          })),
        ),
      });
      if (!res.ok) throw new Error(`Expo push respondeu HTTP ${res.status}`);
      const body = (await res.json()) as {
        data?: { status: string; details?: { error?: string } }[];
      };
      body.data?.forEach((ticket, idx) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered')
          invalidTokens.push(chunk[idx]!);
      });
    }
    return { invalidTokens };
  }
}

/** PUSH_MODE=simulated (padrão; recusado em produção) | expo (opcional: EXPO_ACCESS_TOKEN). */
export function createPushSender(config: ConfigService): PushSender {
  const mode = config.get<string>('PUSH_MODE') ?? 'simulated';
  if (mode === 'simulated') {
    if (config.get('NODE_ENV') === 'production')
      throw new Error('PUSH_MODE=simulated não pode ser usado em produção');
    new Logger('Push').warn('Usando envio de push SIMULADO (PUSH_MODE=simulated)');
    return new SimulatedPushSender();
  }
  if (mode === 'expo') return new ExpoPushSender(config.get<string>('EXPO_ACCESS_TOKEN'));
  throw new Error(`PUSH_MODE inválido: ${mode}`);
}

/** Dados da oferta que entram na notificação. Sem endereços: a tela bloqueada é pública. */
export interface OfferPush {
  id: string;
  expiresAt: Date;
  estimatedNetCents: number;
  deliveryDistanceMeters: number;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  async registerToken(userId: string, token: string, platform: string) {
    // Um token = um aparelho = um usuário: se mudou de dono, passa para quem está logado agora.
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async removeToken(userId: string, token: string) {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  /**
   * Avisa o motorista de uma nova oferta. Nunca lança: a oferta já existe e chega pelo
   * WebSocket/REST; o push é um reforço para quando o app não está aberto.
   */
  async notifyOffer(driverId: string, offer: OfferPush): Promise<void> {
    try {
      const rows = await this.prisma.pushToken.findMany({
        where: { userId: driverId },
        select: { token: true },
      });
      if (rows.length === 0) return;
      const km = (offer.deliveryDistanceMeters / 1000).toFixed(1).replace('.', ',');
      const { invalidTokens } = await this.sender.send(
        rows.map((r) => r.token),
        {
          title: 'Novo pedido de entrega',
          body: `Você recebe ${formatBRL(offer.estimatedNetCents)} · corrida de ${km} km`,
          data: { type: 'offer', offerId: offer.id },
          ttlSeconds: Math.max(1, Math.ceil((offer.expiresAt.getTime() - Date.now()) / 1000)),
        },
      );
      if (invalidTokens.length > 0)
        await this.prisma.pushToken.deleteMany({ where: { token: { in: invalidTokens } } });
    } catch (e) {
      this.logger.warn(`Falha ao enviar push: ${(e as Error).message}`);
    }
  }
}
