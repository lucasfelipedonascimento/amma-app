import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  cardBrand,
  isValidCardCvv,
  isValidCardNumber,
  lastFour,
  parseCardExpiry,
} from '@amma/shared';
import { randomUUID } from 'node:crypto';

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

export function createPaymentProvider(config: ConfigService): PaymentProvider {
  const mode = config.get<string>('PAYMENT_PROVIDER') ?? 'sandbox';
  if (mode === 'sandbox') {
    if (config.get('NODE_ENV') === 'production')
      throw new Error('PAYMENT_PROVIDER=sandbox não pode ser usado em produção');
    new Logger('Pagamentos').warn(
      'Usando provedor de pagamento SIMULADO (PAYMENT_PROVIDER=sandbox)',
    );
    return new SandboxPaymentProvider();
  }
  // Nenhum provedor real foi contratado: não inventar integração (ver docs/DECISOES.md).
  throw new Error(`PAYMENT_PROVIDER inválido: ${mode}`);
}
