import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import type { ReadRequest } from './auth.guard.js';
import { apiError } from './auth.guard.js';
import { parsePaging, parseSort } from './paging.js';

const fields = `u.id, u.name, u.email,
  ARRAY(SELECT role FROM user_roles WHERE user_id = u.id ORDER BY role) AS roles,
  replace(u.created_at::text, ' ', 'T') AS "createdAt",
  replace(u.updated_at::text, ' ', 'T') AS "updatedAt",
  replace(u.last_access_at::text, ' ', 'T') AS "lastAccessAt"`;

@Injectable()
export class IdentityReadService {
  constructor(private readonly database: DatabaseService) {}

  private requireAdmin(request: ReadRequest) {
    if (!request.user.roles.includes('ADMIN')) throw apiError(403, 'Bạn không có quyền thực hiện thao tác này', request.path);
  }

  async list(request: ReadRequest, query: Record<string, unknown>) {
    this.requireAdmin(request);
    const { page, size } = parsePaging(query);
    const order = parseSort(query, {
      id: 'u.id', name: 'u.name', email: 'u.email', phoneNumber: 'u.phone_number',
      createdAt: 'u.created_at', updatedAt: 'u.updated_at', lastAccessAt: 'u.last_access_at', deletedAt: 'u.deleted_at',
    }, request.path, ['name', 'email', 'phoneNumber']);
    return this.database.readSnapshot(async client => {
      const count = await client.query<{ total: string }>('SELECT count(*) AS total FROM users WHERE deleted_at IS NULL');
      const result = await client.query(`SELECT ${fields} FROM users u WHERE u.deleted_at IS NULL ${order} LIMIT $1 OFFSET $2`, [size, page * size]);
      const totalElements = Number(count.rows[0]!.total);
      return { content: result.rows, page: { size, number: page, totalElements, totalPages: Math.ceil(totalElements / size) } };
    });
  }

  async find(request: ReadRequest, kind: 'id' | 'email', value: unknown) {
    if (kind === 'id') {
      // UUID.fromString accepts shortened hexadecimal groups and normalizes them.
      if (typeof value !== 'string' || !/^[0-9a-f]{1,8}-[0-9a-f]{1,4}-[0-9a-f]{1,4}-[0-9a-f]{1,4}-[0-9a-f]{1,12}$/i.test(value)) {
        throw apiError(400, "Tham số 'id' không đúng định dạng", request.path);
      }
      value = value.split('-').map((part, index) => part.padStart([8, 4, 4, 4, 12][index]!, '0')).join('-');
    }
    if (value === undefined) throw apiError(400, "Required parameter 'email' is not present.", request.path);
    this.requireAdmin(request);
    const parameter = kind === 'id' ? String(value).toLowerCase() : String(value);
    const row = await this.database.readSnapshot(async client => {
      const result = await client.query(`SELECT ${fields} FROM users u WHERE u.${kind} = $1 AND u.deleted_at IS NULL`, [parameter]);
      return result.rows[0];
    });
    if (!row) throw apiError(404, `User not found with ${kind}: ${parameter}`, request.path);
    return row;
  }
}
