import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { assertProductionConfig } from './common/prod-config';
import { corsOptions, parseCorsOrigins } from './common/cors';
import { securityHeaders } from './common/security-headers';
import { setupSwagger } from './common/swagger';

async function bootstrap() {
  assertProductionConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Atrás de proxy/balanceador, TRUST_PROXY (nº de proxies, ex.: 1) faz o limite de taxa usar o IP real.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
  app.use(securityHeaders(process.env.NODE_ENV === 'production'));
  // Log de acesso simples (método, rota, status). Não registra corpo nem cabeçalhos (tokens).
  const access = new Logger('HTTP');
  app.use(
    (
      req: { method: string; originalUrl: string },
      res: { statusCode: number; on: (e: string, f: () => void) => void },
      next: () => void,
    ) => {
      const t0 = Date.now();
      res.on('finish', () =>
        access.log(
          `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms`,
        ),
      );
      next();
    },
  );
  // whitelist: descarta campos não declarados nos DTOs (evita mass-assignment).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  // CORS: só as origens de CORS_ORIGINS (vazio = nenhuma origem de navegador).
  app.enableCors(corsOptions(parseCorsOrigins(process.env.CORS_ORIGINS)));
  if (setupSwagger(app)) access.log('Swagger em /docs');
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 3000));
}
bootstrap();
