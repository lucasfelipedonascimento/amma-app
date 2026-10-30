import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssemblyService } from './assembly.service';
import { GroupPurchaseService } from './group-purchase.service';

/**
 * Fecha as votações vencidas e concilia os aportes pendentes com o parceiro a cada ASSOCIATION_TICK_MS (padrão 30 s; 0 desliga — usado nos testes).
 * Fechar é seguro repetir e em várias instâncias: só uma execução vence (trava de linha no banco).
 */
@Injectable()
export class AssociationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AssociationScheduler');
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly everyMs: number;

  constructor(
    config: ConfigService,
    private readonly assembly: AssemblyService,
    private readonly purchase: GroupPurchaseService,
  ) {
    this.everyMs = Number(config.get('ASSOCIATION_TICK_MS') ?? 30_000);
  }

  onModuleInit() {
    if (this.everyMs <= 0) return;
    this.timer = setInterval(() => void this.run(), this.everyMs);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.assembly.closeDue();
      if (n > 0) this.logger.log(`${n} votação(ões) encerrada(s)`);
      const m = await this.purchase.reconcilePending();
      if (m > 0) this.logger.log(`${m} aporte(s) conciliado(s) com o parceiro`);
    } catch (e) {
      this.logger.error((e as Error).message);
    } finally {
      this.running = false;
    }
  }
}
