import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { readConfig } from '../config.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { AssessmentTakingService } from './taking.service.js';
@Injectable()
export class AssessmentExpiryService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AssessmentExpiryService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  constructor(
    private readonly db: DatabaseService,
    private readonly taking: AssessmentTakingService,
  ) {}
  onModuleInit() {
    if (readConfig().assessmentSchedulerEnabled)
      this.timer = setInterval(() => {
        if (!this.running)
          this.running = this.runExpiry()
            .catch(() => this.logger.error('Assessment expiry sweep failed'))
            .finally(() => {
              this.running = undefined;
            });
      }, 30000);
  }
  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  async runExpiry(now = new Date()) {
    if (!readConfig().assessmentSchedulerEnabled) return;
    const cutoff = new Date(now.getTime() - 5000),
      request: ReadRequest = {
        path: '/internal/assessment-expiry',
        headers: {},
        user: { id: '', name: 'scheduler', email: '', roles: [] },
      };
    for (const phase of ['attempt', 'module', 'section'] as const) {
      const candidates = await this.db.readSnapshot(async (c) => {
        if (phase === 'attempt')
          return (
            await c.query(
              "SELECT id AS attempt_id FROM attempt WHERE status='STARTED' AND expires_at<=$1",
              [cutoff],
            )
          ).rows;
        const table = phase === 'module' ? 'attempt_module' : 'attempt_section',
          foreign = phase === 'module' ? 'module_id' : 'section_id';
        return (
          await c.query(
            `SELECT t.attempt_id,t.${foreign} AS part_id FROM ${table} t JOIN attempt a ON a.id=t.attempt_id JOIN assessments s ON s.id=a.assessment_id AND s.deleted_at IS NULL WHERE a.status='STARTED' AND s.timing_mode='STRICT' AND t.status='IN_PROGRESS' AND t.expires_at<=$1`,
            [cutoff],
          )
        ).rows;
      });
      for (const candidate of candidates)
        try {
          await this.db.writeTransaction(async (c) => {
            const a = await this.taking.attempt(
              c,
              candidate.attempt_id,
              request,
              true,
            );
            if (a.status !== 'STARTED') return;
            const past = (value: any) =>
              value !== null &&
              new Date(value).getTime() + 5000 <= now.getTime();
            if (phase === 'attempt') {
              if (past(a.expires_at))
                await this.taking.doSubmit(c, a, 'DEADLINE_EXPIRED', now);
              return;
            }
            if (a.assessment.timing_mode !== 'STRICT') return;
            const sections = await this.taking.sections(c, a);
            if (phase === 'section') {
              const s = sections.find(
                (s) => s.section_id === candidate.part_id,
              );
              if (!s || s.status !== 'IN_PROGRESS' || !past(s.expires_at))
                return;
              await this.taking.closeSection(
                c,
                a,
                s,
                'EXPIRED',
                new Date(s.expires_at),
              );
              if (await this.taking.allClosed(c, a))
                await this.taking.doSubmit(c, a, 'SECTIONS_COMPLETED', now);
            } else {
              for (const s of sections) {
                const modules = await this.taking.modules(c, a, s.section_id),
                  m = modules.find((m) => m.module_id === candidate.part_id);
                if (!m) continue;
                if (m.status !== 'IN_PROGRESS' || !past(m.expires_at)) return;
                const deadline = new Date(m.expires_at);
                await this.taking.closeModule(c, m, 'EXPIRED', deadline);
                m.status = 'EXPIRED';
                await this.taking.advanceModule(c, a, s, m, deadline, now);
                return;
              }
            }
          }, 'assessment');
        } catch {
          this.logger.error('Unable to expire assessment attempt');
        }
    }
  }
}
