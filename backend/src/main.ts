import { NestFactory } from '@nestjs/core';
import { INestApplication, Type, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ProblemDetailsFilter } from './shared/infra/http/problem-details.filter';
import { requestId } from './shared/infra/http/request-id';
import { Logger as PinoLogger } from 'nestjs-pino';
import { PostgresIoAdapter } from './shared/infra/ws/postgres-io.adapter';

export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api/v1');
  app.use(requestId);   // primero: todo lo que siga puede nombrar el pedido
  app.use(helmet());
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());

  // Swagger is intentionally unavailable in production. It may be enabled explicitly
  // in development/test, but never becomes public by forgetting an environment flag.
  if (process.env.NODE_ENV !== 'production' && process.env.SWAGGER_ENABLED !== 'false') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder()
      .setTitle('Turno Médicos API').setDescription('Identidad y autenticación').setVersion('1.0')
      .addBearerAuth().build());
    SwaggerModule.setup('api/v1/docs', app, doc);
  }
  return app;
}

export async function createApp(module?: Type<unknown>) {
  if (!module) {
    const { AppModule } = await import('./app.module');
    module = AppModule;
  }
  return configureApp(await NestFactory.create(module));
}

async function bootstrap() {
  const app = await createApp();
  // Un solo logger para todo: los Logger de Nest salen por pino, con el mismo
  // formato y el mismo id de pedido que el resto.
  app.useLogger(app.get(PinoLogger));

  // Va acá y no en configureApp: los tests e2e montan la app sin base, y pedirles
  // un pool de Postgres para probar un controlador HTTP no tendria sentido.
  const { Pool } = await import('pg');
  const url = process.env.DATABASE_URL;
  const pool = url
    ? new Pool({ connectionString: url, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } })
    : null;
  app.useWebSocketAdapter(new PostgresIoAdapter(app, pool));

  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) void bootstrap();
