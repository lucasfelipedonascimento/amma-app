import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../common/redis.service';

export interface StoredPosition {
  lat: number;
  lng: number;
  /** ISO 8601 UTC do momento em que o servidor recebeu a posição. */
  at: string;
}

/** A posição some sozinha se o motorista parar de enviar (o app foi fechado, sem sinal...). */
const POSITION_TTL_SECONDS = 120;
/** No máximo uma gravação no PostGIS por motorista neste intervalo. */
export const PERSIST_EVERY_SECONDS = 5;

const posKey = (id: string) => `driver:pos:${id}`;
const onlineKey = (id: string) => `driver:online:${id}`;
const persistKey = (id: string) => `driver:persist:${id}`;

/**
 * Cópia "quente" da posição e flag de online no Redis. A fonte durável (e a que o despacho
 * consulta, com índice espacial) é o PostGIS. Se o Redis cair, a API segue funcionando
 * só com o PostGIS: erros aqui são registrados, não propagados.
 */
@Injectable()
export class PositionStore {
  private readonly logger = new Logger('PositionStore');

  constructor(private readonly redis: RedisService) {}

  async set(driverId: string, p: StoredPosition): Promise<void> {
    await this.safe(() =>
      this.redis.set(posKey(driverId), JSON.stringify(p), 'EX', POSITION_TTL_SECONDS),
    );
  }

  async get(driverId: string): Promise<StoredPosition | null> {
    const raw = await this.safe(() => this.redis.get(posKey(driverId)));
    return raw ? (JSON.parse(raw) as StoredPosition) : null;
  }

  async setOnline(driverId: string, online: boolean): Promise<void> {
    await this.safe(async () => {
      if (online) await this.redis.set(onlineKey(driverId), '1');
      else await this.redis.del(onlineKey(driverId));
    });
  }

  /** true/false se o Redis sabe; null se não sabe (chave ausente ou Redis fora). */
  async isOnline(driverId: string): Promise<boolean | null> {
    const v = await this.safe(() => this.redis.get(onlineKey(driverId)));
    return v === '1' ? true : null;
  }

  async remove(driverId: string): Promise<void> {
    await this.safe(() =>
      this.redis.del(posKey(driverId), onlineKey(driverId), persistKey(driverId)),
    );
  }

  /**
   * true = este chamador deve gravar no PostGIS agora (limite de frequência).
   * Se o Redis estiver fora, grava sempre (falha aberta). Atenção: `SET NX` devolve null quando a
   * chave já existe, então "null" aqui significa "ainda na janela", e só exceção significa Redis fora.
   */
  async claimPersistSlot(driverId: string): Promise<boolean> {
    try {
      const r = await this.redis.set(persistKey(driverId), '1', 'EX', PERSIST_EVERY_SECONDS, 'NX');
      return r === 'OK';
    } catch (e) {
      this.logger.warn(`Redis indisponível: ${(e as Error).message}`);
      return true;
    }
  }

  private async safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`Redis indisponível: ${(e as Error).message}`);
      return null;
    }
  }
}
