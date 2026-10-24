import type { ExecutionContext } from '@nestjs/common';
import { Injectable, CanActivate, NotFoundException } from '@nestjs/common';
import { readConfig } from '../config.js';
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (!readConfig().authApiEnabled) throw new NotFoundException();
    const response = context.switchToHttp().getResponse();
    response.setHeader(
      'Cache-Control',
      'no-cache, no-store, max-age=0, must-revalidate',
    );
    response.setHeader('Pragma', 'no-cache');
    return true;
  }
}
