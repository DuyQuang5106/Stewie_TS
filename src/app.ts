import 'reflect-metadata';
import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { readConfig } from './config.js';

export async function createApp() {
  const config = readConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  // Let Java-compatible route validation handle JSON scalar/null bodies as well.
  app.useBodyParser('json', { strict: false, limit: '8mb' });
  app.use(
    (
      error: unknown,
      request: Request,
      _response: Response,
      next: NextFunction,
    ) => {
      const catalogWrite =
        ['POST', 'PUT'].includes(request.method) &&
        /^\/api\/academic\/(topics|skills|tags|tag-groups|stimuli|question-banks|questions)(?:\/[^/]+(?:\/(?:publish|archive|restore|revise|duplicate|transfer-ownership))?)?$/.test(
          request.path,
        );
      const workflowWrite =
        request.method === 'POST' &&
        /^\/api\/academic\/(?:question-versions\/[^/]+\/reviews|question-imports\/(?:validate|[^/]+\/commit))$/.test(
          request.path,
        );
      if (
        (catalogWrite || workflowWrite) &&
        (error as { type?: string })?.type === 'entity.parse.failed'
      ) {
        // Let the JWT guard run first, then preserve Java's unreadable-body response.
        request.body = null;
        next();
      } else next(error);
    },
  );
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  return app;
}
