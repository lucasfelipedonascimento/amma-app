import { describe, expect, it } from 'vitest';
import { assertProductionConfig } from './prod-config';

const ok = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://amma:s3gredo@db:5432/amma',
  REDIS_URL: 'rediss://cache:6380',
  PUBLIC_BASE_URL: 'https://api.amma.app',
};

describe('assertProductionConfig', () => {
  it('não interfere fora de produção', () => {
    expect(() => assertProductionConfig({ DATABASE_URL: 'x@amma_dev' })).not.toThrow();
  });
  it('aceita configuração de produção válida', () => {
    expect(() => assertProductionConfig(ok)).not.toThrow();
  });
  it('com Mapbox exige o teto diário de rotas', () => {
    const mapbox = { ...ok, ROUTE_PROVIDER: 'mapbox', MAPBOX_ACCESS_TOKEN: 't' };
    expect(() => assertProductionConfig(mapbox)).toThrow(/ROUTE_DAILY_LIMIT/);
    expect(() => assertProductionConfig({ ...mapbox, ROUTE_DAILY_LIMIT: '5000' })).not.toThrow();
  });
  it('provedor de pagamento real exige o segredo do webhook', () => {
    const real = { ...ok, PAYMENT_PROVIDER: 'asaas' };
    expect(() => assertProductionConfig(real)).toThrow(/PAYMENT_WEBHOOK_SECRET/);
    expect(() => assertProductionConfig({ ...real, PAYMENT_WEBHOOK_SECRET: 'x' })).not.toThrow();
  });
  it.each([
    ['senha padrão', { DATABASE_URL: 'postgresql://amma:amma_dev@db/amma' }],
    ['sem Redis', { REDIS_URL: undefined }],
    ['sem banco', { DATABASE_URL: undefined }],
    ['URL pública sem https', { PUBLIC_BASE_URL: 'http://api.amma.app' }],
  ])('recusa: %s', (_n, patch) => {
    expect(() => assertProductionConfig({ ...ok, ...patch })).toThrow(/insegura/);
  });
});
