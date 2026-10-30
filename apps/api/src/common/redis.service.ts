import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Conexão única com o Redis (REDIS_URL). Posição em tempo real, flags e travas leves. */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
      // Falha rápido em vez de enfileirar comandos para sempre quando o Redis cai.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    const logger = new Logger('Redis');
    this.on('error', (e) => logger.warn(`Redis: ${e.message}`));
  }

  async onModuleDestroy() {
    this.disconnect();
  }
}
