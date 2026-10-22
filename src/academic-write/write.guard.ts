import { Injectable, NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JavaJwtGuard } from '../read-api/auth.guard.js';
import { DatabaseService } from '../database.service.js';
import { readConfig } from '../config.js';

@Injectable()
export class AcademicWriteGuard extends JavaJwtGuard {
  constructor(database: DatabaseService) {
    super(database);
  }
  override canActivate(context: ExecutionContext): Promise<boolean> {
    if (!readConfig().academicWriteApiEnabled) throw new NotFoundException();
    return super.canActivate(context);
  }
}
