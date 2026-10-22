import { createApp } from './app.js';
import { readConfig } from './config.js';
import { ConsoleLogger } from '@nestjs/common';

async function bootstrap() {
  const app = await createApp();
  await app.listen(readConfig().port, '0.0.0.0');
}

void bootstrap().catch(() => {
  new ConsoleLogger({ json: true }).error('API startup failed; check DATABASE_URL, PORT, NODE_ENV, CORS_ALLOWED_ORIGINS, READ_API_ENABLED and APP_JWTSECRET');
  process.exitCode = 1;
});
