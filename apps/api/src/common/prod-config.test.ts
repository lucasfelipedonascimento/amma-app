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
  it('parceiro financeiro real exige o segredo do webhook', () => {
    const real = { ...ok, PURCHASE_PARTNER: 'cooperativa' };
    expect(() => assertProductionConfig(real)).toThrow(/PARTNER_WEBHOOK_SECRET/);
    expect(() => assertProductionConfig({ ...real, PARTNER_WEBHOOK_SECRET: 'x' })).not.toThrow();
  });
  it.each([
    ['senha padrão', { DATABASE_URL: 'postgresql://amma:amma_dev@db/amma' }],
    ['sem Redis', { REDIS_URL: undefined }],
    ['sem banco', { DATABASE_URL: undefined }],
    ['URL pública sem https', { PUBLIC_BASE_URL: 'http://api.amma.app' }],
  ])('recusa: %s', (_n, patch) => {
    expect(() => assertProductionConfig({ ...ok, ...patch })).toThrow(/insegura/);
  });
  it('leitor de documentos exige URL e token forte; aprovação automática exige o leitor', () => {
    const http = { ...ok, DOC_READER_MODE: 'http' };
    expect(() => assertProductionConfig(http)).toThrow(/DOC_READER_URL.*DOC_READER_TOKEN/);
    const url = { ...http, DOC_READER_URL: 'http://leitor:8001' };
    expect(() => assertProductionConfig({ ...url, DOC_READER_TOKEN: 'curto' })).toThrow(
      /DOC_READER_TOKEN/,
    );
    expect(() =>
      assertProductionConfig({ ...url, DOC_READER_TOKEN: 't'.repeat(32) }),
    ).not.toThrow();
    expect(() => assertProductionConfig({ ...ok, DOC_AUTO_APPROVE: 'true' })).toThrow(
      /DOC_AUTO_APPROVE/,
    );
  });
});
