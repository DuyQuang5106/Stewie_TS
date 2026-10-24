import { Injectable, NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JavaJwtGuard } from '../read-api/auth.guard.js';
import { DatabaseService } from '../database.service.js';
import { readConfig } from '../config.js';
@Injectable()
export class AssessmentGuard extends JavaJwtGuard {
  constructor(db: DatabaseService) {
    super(db);
  }
  override canActivate(c: ExecutionContext) {
    if (!readConfig().assessmentApiEnabled) throw new NotFoundException();
    return super.canActivate(c);
  }
}
