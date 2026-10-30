import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { corsOptions, parseCorsOrigins } from './common/cors';
import { setupSwagger } from './common/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
