import 'dotenv/config';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5273')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API in ascolto su http://localhost:${port}/api`);
}

void bootstrap();
