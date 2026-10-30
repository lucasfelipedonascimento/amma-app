import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SANDBOX_PARTNER_MAX_CONTRIBUTION_CENTS } from '@amma/shared';
import { randomUUID } from 'node:crypto';

export interface PartnerContribution {
  /** Id do aporte na AMMA; o parceiro usa para não registrar duas vezes. */
  reference: string;
  groupId: string;
  userId: string;
  amountCents: number;
}

export type PartnerResult =
  { accepted: true; partnerRef: string } | { accepted: false; reason: string };

/** Parceiro fora do ar ou em erro: diferente de recusa. Nada é registrado e o sócio pode tentar de novo. */
export class PartnerUnavailableError extends Error {}

/**
 * Parceiro regulado da compra coletiva (consórcio ou cooperativa de crédito). A AMMA NÃO capta
 * dinheiro nem concede crédito: o sócio paga ao parceiro e a AMMA só registra o aporte.
 * `registerContribution` TEM de ser idempotente por `reference`. Trocar de parceiro = implementar esta interface.
 */
export interface PurchasePartner {
  readonly name: string;
  readonly sandbox: boolean;
  registerContribution(c: PartnerContribution): Promise<PartnerResult>;
}

export const PURCHASE_PARTNER = Symbol('PURCHASE_PARTNER');

/** Valor (em centavos) que faz o parceiro simulado ficar "fora do ar", para testar a falha. */
export const SANDBOX_PARTNER_DOWN_CENTS = 1313;

/**
 * Parceiro simulado: sem rede e determinístico. Nenhum dinheiro se move.
 *   aporte de R$ 13,13 → parceiro indisponível · acima de R$ 10.000,00 → recusado · demais → aceito.
 */
export class SandboxPurchasePartner implements PurchasePartner {
  readonly name = 'sandbox';
  readonly sandbox = true;
  private readonly seen = new Map<string, string>();

  async registerContribution(c: PartnerContribution): Promise<PartnerResult> {
    if (c.amountCents === SANDBOX_PARTNER_DOWN_CENTS)
      throw new PartnerUnavailableError('Parceiro simulado indisponível');
    if (c.amountCents > SANDBOX_PARTNER_MAX_CONTRIBUTION_CENTS)
      return { accepted: false, reason: 'Valor acima do limite do parceiro' };
    const partnerRef = this.seen.get(c.reference) ?? `part_sbx_${randomUUID()}`;
    this.seen.set(c.reference, partnerRef);
    return { accepted: true, partnerRef };
  }
}

export function createPurchasePartner(config: ConfigService): PurchasePartner {
  const mode = config.get<string>('PURCHASE_PARTNER') ?? 'sandbox';
  if (mode === 'sandbox') {
    if (config.get('NODE_ENV') === 'production')
      throw new Error('PURCHASE_PARTNER=sandbox não pode ser usado em produção');
    new Logger('CompraColetiva').warn(
      'Usando parceiro de compra coletiva SIMULADO (PURCHASE_PARTNER=sandbox)',
    );
    return new SandboxPurchasePartner();
  }
  // Nenhum parceiro (consórcio/cooperativa) foi contratado: não inventar integração.
  throw new Error(`PURCHASE_PARTNER inválido: ${mode}`);
}
