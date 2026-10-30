import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDatabaseUrl, testRedisUrl } from './env';

// Antes de qualquer import da aplicação (o ConfigModule não sobrescreve variáveis já definidas).
process.env.DATABASE_URL = testDatabaseUrl();
process.env.REDIS_URL = testRedisUrl();
process.env.JWT_SECRET = 'segredo-de-teste-nao-usar-em-producao';
process.env.OTP_MODE = 'simulated';
process.env.ROUTE_PROVIDER = 'simulated';
process.env.NODE_ENV = 'test';
// Sem rotina automática: os testes chamam DispatchService.tick() quando querem.
process.env.DISPATCH_TICK_MS = '0';
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'amma-test-'));
// Fechamento de votações só quando o teste chama (ou ao ler a proposta).
process.env.ASSOCIATION_TICK_MS = '0';
// Os testes fazem dezenas de logins do mesmo IP: limites de taxa folgados (o teste de limite os restaura).
process.env.RATE_LIMIT_SCALE = '1000';
// Revalidação das conexões WebSocket (bloqueio, exclusão, logout) a cada 300 ms nos testes.
process.env.WS_REVALIDATE_MS = '300';
