import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SANDBOX_PARTNER_MAX_CONTRIBUTION_CENTS } from '@amma/shared';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface PartnerContribution {
  /** Id do aporte na AMMA; o parceiro usa para não registrar duas vezes. */
  reference: string;
  groupId: string;
  userId: string;
  amountCents: number;
}

/**
 * Situação de um aporte no parceiro. Parceiros reais costumam confirmar DEPOIS (o sócio paga o
 * boleto ou Pix do parceiro e ele avisa), por isso PENDENTE existe: nada entra no ledger até confirmar.
 */
export type PartnerResult =
  | { status: 'CONFIRMADO'; partnerRef: string }
  | {
      status: 'PENDENTE';
      partnerRef: string;
      /** Como o sócio paga ao parceiro (link, código Pix, linha do boleto). Mostrado no app. */
      instructions?: string;
    }
  | { status: 'RECUSADO'; reason: string };

/** Aviso do parceiro (webhook) já validado e traduzido para o nosso vocabulário. */
export interface PartnerEvent {
  /** Id único do aviso no parceiro, para ignorar reenvios. */
  eventId: string;
  partnerRef: string;
  outcome: 'CONFIRMADO' | 'RECUSADO';
  reason?: string;
}

/** Parceiro fora do ar ou em erro: diferente de recusa. Nada é registrado e o sócio pode tentar de novo. */
export class PartnerUnavailableError extends Error {}

/** Assinatura ausente ou errada: o aviso NÃO veio do parceiro. */
export class InvalidPartnerWebhookError extends Error {}

/**
 * Parceiro regulado da compra coletiva (consórcio ou cooperativa de crédito). A AMMA NÃO capta
 * dinheiro nem concede crédito: o sócio paga ao parceiro e a AMMA só registra o aporte.
 * Trocar de parceiro = implementar esta interface (docs/INTEGRACAO_PARCEIRO.md).
 */
export interface PurchasePartner {
  readonly name: string;
  readonly sandbox: boolean;
  /** TEM de ser idempotente por `reference` (a API repete a chamada quando algo falha no meio). */
  registerContribution(c: PartnerContribution): Promise<PartnerResult>;
  /**
   * Consulta a situação de um aporte já registrado. A API usa na conciliação periódica: se o aviso
   * (webhook) se perder, o aporte PENDENTE não fica pendente para sempre.
   */
  fetchContribution(partnerRef: string): Promise<PartnerResult>;
  /**
   * Valida a assinatura do aviso e o traduz. Lança `InvalidPartnerWebhookError` se a assinatura não bate.
   * Devolve `null` para avisos que não interessam (a API responde 200 e ignora).
   * `rawBody` são os bytes EXATOS recebidos: a assinatura é calculada sobre eles.
   */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): PartnerEvent | null;
}

export const PURCHASE_PARTNER = Symbol('PURCHASE_PARTNER');

/** Valor (em centavos) que faz o parceiro simulado ficar "fora do ar", para testar a falha. */
export const SANDBOX_PARTNER_DOWN_CENTS = 1313;
/** Valor (em centavos) que deixa o aporte PENDENTE no parceiro simulado, até alguém resolver. */
export const SANDBOX_PARTNER_PENDING_CENTS = 5050;

/**
 * Parceiro simulado: sem rede e determinístico. Nenhum dinheiro se move.
 *   R$ 13,13 → parceiro indisponível · R$ 50,50 → pendente (confirma por webhook ou conciliação)
 *   acima de R$ 10.000,00 → recusado · demais → aceito.
 */
export class SandboxPurchasePartner implements PurchasePartner {
  readonly name = 'sandbox';
  readonly sandbox = true;
  private readonly seen = new Map<string, PartnerResult>();

  constructor(private readonly webhookSecret = 'segredo-parceiro-sandbox') {}

  /** Assinatura que o sandbox espera em `x-amma-signature` (HMAC-SHA256 em hexadecimal). */
  sign(rawBody: Buffer | string): string {
    return createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
  }

  /** Faz o papel do parceiro decidindo um aporte pendente (o aviso em si vai por `parseWebhook`). */
  resolve(
    partnerRef: string,
    outcome: 'CONFIRMADO' | 'RECUSADO',
    reason = 'Recusado pelo parceiro',
  ) {
    this.seen.set(
      partnerRef,
      outcome === 'CONFIRMADO'
        ? { status: 'CONFIRMADO', partnerRef }
        : { status: 'RECUSADO', reason },
    );
  }

  async registerContribution(c: PartnerContribution): Promise<PartnerResult> {
    if (c.amountCents === SANDBOX_PARTNER_DOWN_CENTS)
      throw new PartnerUnavailableError('Parceiro simulado indisponível');
    if (c.amountCents > SANDBOX_PARTNER_MAX_CONTRIBUTION_CENTS)
      return { status: 'RECUSADO', reason: 'Valor acima do limite do parceiro' };
    const existing = this.seen.get(c.reference);
    if (existing) return existing;
    const partnerRef = `part_sbx_${randomUUID()}`;
    const result: PartnerResult =
      c.amountCents === SANDBOX_PARTNER_PENDING_CENTS
        ? { status: 'PENDENTE', partnerRef, instructions: `PAGUE-SIMULADO|${partnerRef}` }
        : { status: 'CONFIRMADO', partnerRef };
    this.seen.set(c.reference, result);
    this.seen.set(partnerRef, result);
    return result;
  }

  async fetchContribution(partnerRef: string): Promise<PartnerResult> {
    const r = this.seen.get(partnerRef);
    if (!r) throw new PartnerUnavailableError('Aporte desconhecido no parceiro simulado');
    return r;
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const got = String(headers['x-amma-signature'] ?? '');
    const want = this.sign(rawBody);
    if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want)))
      throw new InvalidPartnerWebhookError('Assinatura inválida');
    let body: { id?: string; type?: string; partnerRef?: string; reason?: string };
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidPartnerWebhookError('Corpo inválido');
    }
    if (!body.id || !body.partnerRef) return null;
    if (body.type === 'contribution.confirmed')
      return { eventId: body.id, partnerRef: body.partnerRef, outcome: 'CONFIRMADO' as const };
    if (body.type === 'contribution.declined')
      return {
        eventId: body.id,
        partnerRef: body.partnerRef,
        outcome: 'RECUSADO' as const,
        reason: body.reason,
      };
    return null;
  }
}

/**
 * Parceiros disponíveis por `PURCHASE_PARTNER`. Para ligar um parceiro real: implemente `PurchasePartner`
 * num arquivo novo (ex.: `cooperativa-partner.ts`), registre aqui e siga docs/INTEGRACAO_PARCEIRO.md.
 * Cada fábrica recebe a configuração e valida as próprias chaves (falhando no boot se faltar).
 */
export const REAL_PARTNERS: Record<string, (config: ConfigService) => PurchasePartner> = {};

export function createPurchasePartner(config: ConfigService): PurchasePartner {
  const mode = config.get<string>('PURCHASE_PARTNER') ?? 'sandbox';
  if (mode === 'sandbox') {
    if (config.get('NODE_ENV') === 'production')
      throw new Error('PURCHASE_PARTNER=sandbox não pode ser usado em produção');
    new Logger('CompraColetiva').warn(
      'Usando parceiro de compra coletiva SIMULADO (PURCHASE_PARTNER=sandbox)',
    );
    return new SandboxPurchasePartner(config.get<string>('PARTNER_WEBHOOK_SECRET') || undefined);
  }
  const factory = REAL_PARTNERS[mode];
  if (!factory) {
    const known = ['sandbox', ...Object.keys(REAL_PARTNERS)].join(' | ');
    throw new Error(`PURCHASE_PARTNER inválido: ${mode} (disponíveis: ${known})`);
  }
  return factory(config);
}
