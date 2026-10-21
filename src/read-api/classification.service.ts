import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import type { ReadRequest } from './auth.guard.js';
import { apiError } from './auth.guard.js';
import { parsePaging, parseSort } from './paging.js';

@Injectable()
export class ClassificationReadService {
  constructor(private readonly database: DatabaseService) {}

  async list(table: 'topic' | 'skill', request: ReadRequest, query: Record<string, unknown>) {
    const roles = request.user.roles;
    const { page, size } = parsePaging(query);
    let includeArchived = false;
    if (query.includeArchived !== undefined && query.includeArchived !== '') {
      const value = String(query.includeArchived).toLowerCase();
      if (!['true', 'false', 'on', 'off', 'yes', 'no', '1', '0'].includes(value)) {
        throw apiError(400, "Tham số 'includeArchived' không đúng định dạng", request.path);
      }
      includeArchived = ['true', 'on', 'yes', '1'].includes(value);
    }
    if (!roles.some(role => ['ADMIN', 'TEACHER'].includes(role))) {
      throw apiError(403, 'Bạn không có quyền thực hiện thao tác này', request.path);
    }
    const order = parseSort(query, { id: 'id', name: 'name', slug: 'slug', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' }, request.path, ['name', 'slug']);
    const where = includeArchived && roles.includes('ADMIN') ? '' : "WHERE status = 'ACTIVE'";
    const result = await this.database.readSnapshot(async client => {
      const count = await client.query<{ total: string }>(`SELECT count(*) AS total FROM ${table} ${where}`);
      const rows = await client.query(`SELECT id, name, slug, status,
        replace(created_at::text, ' ', 'T') AS "createdAt", replace(updated_at::text, ' ', 'T') AS "updatedAt"
        FROM ${table} ${where} ${order} LIMIT $1 OFFSET $2`, [size, page * size]);
      return { total: Number(count.rows[0]!.total), content: rows.rows };
    });
    const totalPages = Math.ceil(result.total / size);
    return { content: result.content, page: { size, number: page, totalElements: result.total, totalPages } };
  }
}
