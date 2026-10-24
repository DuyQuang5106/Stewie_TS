import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { readConfig } from '../config.js';
@Injectable()
export class RefreshCleanupService
  implements OnModuleInit, OnApplicationShutdown
{
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private running?: Promise<unknown>;
  private readonly logger = new Logger(RefreshCleanupService.name);
  constructor(private readonly auth: AuthService) {}
  onModuleInit() {
    if (readConfig().authCleanupEnabled) this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    const now = new Date(),
      next = new Date(now);
    next.setHours(3, 30, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    this.timer = setTimeout(() => {
      this.running = this.auth
        .cleanup()
        .catch(() => this.logger.error('Refresh token cleanup failed'))
        .finally(() => this.schedule());
    }, next.getTime() - now.getTime());
    this.timer.unref();
  }
  async onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}
