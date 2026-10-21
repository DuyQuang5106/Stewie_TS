import type { ExecutionContext } from '@nestjs/common';
import { CanActivate, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
const { verify } = jwt;
import { DatabaseService } from '../database.service.js';
import { readConfig } from '../config.js';

export interface CurrentUser { id: string; name: string; email: string; roles: string[] }
export interface ReadRequest {
  headers: { authorization?: string; cookie?: string };
  user: CurrentUser;
  path: string;
}

export function apiError(status: number, message: string, path: string): HttpException {
  return new HttpException({ timestamp: new Date().toISOString().replace(/Z$/, ''), status,
    error: status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Bad Request', message, path, fieldErrors: {} }, status);
}

@Injectable()
export class JavaJwtGuard implements CanActivate {
  private readonly logger = new Logger(JavaJwtGuard.name);
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = readConfig();
    if (!config.readApiEnabled) throw new NotFoundException();
    const request = context.switchToHttp().getRequest<ReadRequest>();
    const bearer = request.headers.authorization;
    const cookie = request.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('token='))?.slice(6);
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : cookie;
    const unauthorized = () => new HttpException({ status: 401, error: 'Unauthorized',
      message: 'Token không hợp lệ hoặc đã hết hạn' }, 401);
    let id: string;
    try {
      const claims = verify(token ?? '', Buffer.from(config.jwtSecret, 'utf8'), { algorithms: ['HS256'] });
      if (typeof claims === 'string' || typeof claims.sub !== 'string'
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)) throw unauthorized();
      id = claims.sub;
    } catch { throw unauthorized(); }
    const user = await this.database.readSnapshot(async client => {
      const result = await client.query<CurrentUser>(`SELECT u.id, u.name, u.email,
        COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), ARRAY[]::varchar[]) AS roles
        FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
        WHERE u.id = $1 AND u.deleted_at IS NULL GROUP BY u.id`, [id]);
      return result.rows[0];
    }).catch(() => {
      this.logger.warn('Unable to load authenticated user');
      // Java's authentication filter leaves the request unauthenticated on DB errors.
      throw unauthorized();
    });
    if (!user) throw unauthorized();
    request.user = user;
    return true;
  }
}
