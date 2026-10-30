import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Só dá para escrever enquanto há motorista atendendo (aceito até a entrega). */
const CHAT_OPEN = ['ACEITO', 'A_CAMINHO_COLETA', 'COLETADO', 'A_CAMINHO_ENTREGA'] as const;
const HISTORY_LIMIT = 100;

export interface ChatMessageView {
  id: string;
  deliveryId: string;
  body: string;
  createdAt: string;
  fromMe: boolean;
}

/** Chat entre o cliente (ou passageiro) e o motorista de um pedido. Só os dois participantes enxergam. */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  /** Pedido em que a pessoa é cliente ou motorista. Para os demais (inclusive admin), "não encontrado". */
  private async participant(user: AuthUser, deliveryId: string) {
    const d = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, clientId: true, workerId: true },
    });
    if (!d || (d.clientId !== user.id && d.workerId !== user.id))
      throw new NotFoundException('Pedido não encontrado');
    return d;
  }

  async list(user: AuthUser, deliveryId: string): Promise<ChatMessageView[]> {
    await this.participant(user, deliveryId);
    const rows = await this.prisma.deliveryMessage.findMany({
      where: { deliveryId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    return rows.reverse().map((m) => this.view(m, user.id));
  }

  async send(user: AuthUser, deliveryId: string, body: string): Promise<ChatMessageView> {
    const d = await this.participant(user, deliveryId);
    if (!d.workerId || !(CHAT_OPEN as readonly string[]).includes(d.status))
      throw new ConflictException('O chat só fica aberto durante o atendimento');
    const text = body.trim();
    if (!text) throw new ConflictException('Escreva uma mensagem');
    const m = await this.prisma.deliveryMessage.create({
      data: { deliveryId, senderId: user.id, body: text },
    });
    const toClient = user.id === d.workerId;
    const to = toClient ? d.clientId : d.workerId;
    this.realtime.sendToUser(to, 'chat.message', { deliveryId, message: this.view(m, to) });
    // Sem o app aberto (sem WebSocket), um push avisa.
    if (!this.realtime.isConnected(to))
      void this.push.notifyChat(to, deliveryId, toClient ? 'MOTORISTA' : 'CLIENTE');
    return this.view(m, user.id);
  }

  private view(
    m: { id: string; deliveryId: string; senderId: string; body: string; createdAt: Date },
    viewerId: string,
  ): ChatMessageView {
    return {
      id: m.id,
      deliveryId: m.deliveryId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      fromMe: m.senderId === viewerId,
    };
  }
}
