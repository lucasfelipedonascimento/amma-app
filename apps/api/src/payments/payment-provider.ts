import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  cardBrand,
  isValidCardCvv,
  isValidCardNumber,
  lastFour,
  parseCardExpiry,
} from '@amma/shared';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { SplitLine } from '@amma/shared';

export interface PixCharge {
  reference: string;
  amountCents: number;
  expiresAt: Date;
}

export interface CardCharge {
  reference: string;
  amountCents: number;
  /** Token que o provedor devolveu ao app. O número do cartão nunca chega à nossa API. */
  cardToken: string;
}

export type CardResult =
  | { approved: true; providerRef: string; brand: string; last4: string }
  | { approved: false; reason: string };

/** Repasse do valor pago aos destinatários, depois da entrega concluída. */
export interface SplitRequest {
  providerRef: string;
  /** Id do pedido; serve de chave de idempotência no provedor. */
  reference: string;
  lines: SplitLine[];
}

/** Aviso do provedor (webhook) já validado e traduzido para o nosso vocabulário. */
export interface PaymentEvent {
  /** Id único do aviso no provedor, para ignorar reenvios. */
  eventId: string;
  type: 'PIX_PAID';
  providerRef: string;
}

/** Assinatura ausente ou errada: o aviso NÃO veio do provedor. */
export class InvalidWebhookError extends Error {}

/** Falha do provedor (fora do ar, timeout). Diferente de recusa: o cliente pode tentar de novo. */
export class PaymentUnavailableError extends Error {}

/**
 * Parceiro de pagamento regulado. A AMMA não custodia dinheiro: o provedor cobra, repassa e estorna.
 * Trocar de provedor = implementar esta interface. `refund` TEM de ser idempotente por `providerRef`
 * (repetir a chamada não devolve duas vezes), porque a API tenta de novo quando algo falha no meio.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly sandbox: boolean;
  createPix(c: PixCharge): Promise<{ providerRef: string; pixCode: string }>;
  chargeCard(c: CardCharge): Promise<CardResult>;
  refund(i: { providerRef: string; amountCents: number }): Promise<{ refundRef: string }>;
  /**
   * Repassa o valor pago: trabalhador, taxa base e taxa da associação. Chamado uma vez por pedido,
   * depois do ENTREGUE (só aí se sabe quem é o motorista e qual taxa vale). TEM de ser idempotente
   * por `reference`. Provedor sem divisão nativa pode registrar o repasse e liquidar por fora.
   */
  settleSplit(r: SplitRequest): Promise<{ splitRef: string }>;
  /**
   * Valida a assinatura do aviso e o traduz. Lança `InvalidWebhookError` se a assinatura não bate.
   * Devolve `null` para avisos que não interessam (a API responde 200 e ignora).
   * `rawBody` são os bytes EXATOS recebidos: a assinatura é calculada sobre eles.
   */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): PaymentEvent | null;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface SandboxCardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvv: string;
}

const TOKEN = /^sbx_(ok|declined|insufficient|error)_(\d{4})_([a-z]+)$/;

/**
 * Provedor simulado (desenvolvimento e testes): sem rede, determinístico, recusado em produção.
 * Imita as regras dos cartões de teste dos provedores reais:
 *   4000 0000 0000 0002 → recusado · 4000 0000 0000 9995 → saldo insuficiente
 *   4000 0000 0000 0119 → provedor indisponível · qualquer outro número válido → aprovado.
 * O Pix só vira pago quando algo chama `PaymentsService.confirmPix` (no real, é o webhook do provedor).
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = 'sandbox';
  readonly sandbox = true;
  private readonly refunds = new Map<string, string>();
  private readonly splits = new Map<string, string>();

  constructor(private readonly webhookSecret = 'segredo-webhook-sandbox') {}

  /** Assinatura que o sandbox espera no cabeçalho `x-amma-signature` (HMAC-SHA256 em hexadecimal). */
  sign(rawBody: Buffer | string): string {
    return createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
  }

  async settleSplit(r: SplitRequest) {
    const existing = this.splits.get(r.reference);
    if (existing) return { splitRef: existing };
    const splitRef = `split_sbx_${randomUUID()}`;
    this.splits.set(r.reference, splitRef);
    return { splitRef };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const got = String(headers['x-amma-signature'] ?? '');
    const want = this.sign(rawBody);
    if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want)))
      throw new InvalidWebhookError('Assinatura inválida');
    let body: { id?: string; type?: string; providerRef?: string };
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidWebhookError('Corpo inválido');
    }
    if (body.type !== 'pix.paid' || !body.id || !body.providerRef) return null;
    return { eventId: body.id, type: 'PIX_PAID' as const, providerRef: body.providerRef };
  }

  async createPix(c: PixCharge) {
    const providerRef = `pix_sbx_${randomUUID()}`;
    // Parece um "copia e cola", mas é claramente de mentira: nenhum banco paga isto.
    return { providerRef, pixCode: `PIX-SIMULADO|${providerRef}|${c.amountCents}` };
  }

  /** Faz o papel do SDK do provedor no app: troca os dados do cartão por um token. */
  tokenizeCard(
    card: SandboxCardInput,
    now = new Date(),
  ): { token: string; brand: string; last4: string } {
    if (!isValidCardNumber(card.number)) throw new Error('Número de cartão inválido');
    const brand = cardBrand(card.number);
    if (!isValidCardCvv(card.cvv, brand)) throw new Error('Código de segurança inválido');
    if (
      !parseCardExpiry(
        `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear % 100).padStart(2, '0')}`,
        now,
      )
    )
      throw new Error('Cartão vencido ou validade inválida');
    const digits = card.number.replace(/\D/g, '');
    const outcome =
      digits === '4000000000000002'
        ? 'declined'
        : digits === '4000000000009995'
          ? 'insufficient'
          : digits === '4000000000000119'
            ? 'error'
            : 'ok';
    const last4 = lastFour(digits);
    return { token: `sbx_${outcome}_${last4}_${brand}`, brand, last4 };
  }

  async chargeCard(c: CardCharge): Promise<CardResult> {
    const m = TOKEN.exec(c.cardToken);
    if (!m) return { approved: false, reason: 'Cartão não reconhecido' };
    const [, outcome, last4, brand] = m as unknown as [string, string, string, string];
    if (outcome === 'error') throw new PaymentUnavailableError('Provedor simulado indisponível');
    if (outcome === 'declined') return { approved: false, reason: 'Cartão recusado pelo banco' };
    if (outcome === 'insufficient') return { approved: false, reason: 'Saldo insuficiente' };
    return { approved: true, providerRef: `card_sbx_${randomUUID()}`, brand, last4 };
  }

  async refund(i: { providerRef: string; amountCents: number }) {
    const existing = this.refunds.get(i.providerRef);
    if (existing) return { refundRef: existing };
    const refundRef = `re_sbx_${randomUUID()}`;
    this.refunds.set(i.providerRef, refundRef);
    return { refundRef };
  }
}

/**
 * Provedores disponíveis por `PAYMENT_PROVIDER`. Para ligar um provedor real: implemente `PaymentProvider`
 * num arquivo novo (ex.: `asaas-provider.ts`), registre aqui e siga docs/INTEGRACAO_PAGAMENTO.md.
 * Cada fábrica recebe a configuração e valida as próprias chaves (falhando no boot se faltar).
 */
const REAL_PROVIDERS: Record<string, (config: ConfigService) => PaymentProvider> = {};

export function createPaymentProvider(config: ConfigService): PaymentProvider {
  const mode = config.get<string>('PAYMENT_PROVIDER') ?? 'sandbox';
  if (mode === 'sandbox') {
    if (config.get('NODE_ENV') === 'production')
      throw new Error('PAYMENT_PROVIDER=sandbox não pode ser usado em produção');
    new Logger('Pagamentos').warn(
      'Usando provedor de pagamento SIMULADO (PAYMENT_PROVIDER=sandbox)',
    );
    return new SandboxPaymentProvider(config.get<string>('PAYMENT_WEBHOOK_SECRET') || undefined);
  }
  const factory = REAL_PROVIDERS[mode];
  if (!factory) {
    const known = ['sandbox', ...Object.keys(REAL_PROVIDERS)].join(' | ');
    throw new Error(`PAYMENT_PROVIDER inválido: ${mode} (disponíveis: ${known})`);
  }
  return factory(config);
}
