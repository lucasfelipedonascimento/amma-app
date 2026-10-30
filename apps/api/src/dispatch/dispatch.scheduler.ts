import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../common/redis.service';
import { PaymentsService } from '../payments/payments.service';
import { DispatchService } from './dispatch.service';

/**
 * Chama DispatchService.tick() a cada DISPATCH_TICK_MS (padrão 3000; 0 desliga — usado nos testes,
 * que chamam tick() à mão). Com várias instâncias, uma trava no Redis evita rodadas duplicadas;
 * se o Redis estiver fora, todas rodam (as operações são idempotentes por compare-and-set).
 */
@Injectable()
export class DispatchScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DispatchScheduler');
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly everyMs: number;

  constructor(
    config: ConfigService,
    private readonly dispatch: DispatchService,
    private readonly redis: RedisService,
    private readonly payments: PaymentsService,
  ) {
    this.everyMs = Number(config.get('DISPATCH_TICK_MS') ?? 3000);
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
      const lock = await this.redis
        .set('lock:dispatch-tick', '1', 'PX', Math.max(this.everyMs - 100, 500), 'NX')
        .catch(() => 'OK');
      if (lock === 'OK') {
        await this.dispatch.tick();
        await this.payments.tick();
      }
    } catch (e) {
      this.logger.error((e as Error).message);
    } finally {
      this.running = false;
    }
  }
}
