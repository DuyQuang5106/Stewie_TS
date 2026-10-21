import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../database.service.js';
import type { ReadRequest } from './auth.guard.js';
import { apiError } from './auth.guard.js';
import { parsePaging, parseSort } from './paging.js';

export function academicUuid(value: string, request: ReadRequest, name = 'id') {
  if (!/^[0-9a-f]{1,8}-[0-9a-f]{1,4}-[0-9a-f]{1,4}-[0-9a-f]{1,4}-[0-9a-f]{1,12}$/i.test(value)) {
    throw apiError(400, `Tham số '${name}' không đúng định dạng`, request.path);
  }
  return value.split('-').map((s, i) => s.padStart([8, 4, 4, 4, 12][i]!, '0')).join('-').toLowerCase();
}
export function requireAuthor(request: ReadRequest) {
  if (!request.user.roles.some(r => r === 'ADMIN' || r === 'TEACHER')) {
    throw apiError(403, 'Bạn không có quyền thực hiện thao tác này', request.path);
  }
}
export const dates = (alias: string) => `replace(${alias}.created_at::text, ' ', 'T') AS "createdAt",
  replace(${alias}.updated_at::text, ' ', 'T') AS "updatedAt"`;
const tagFields = `t.id, t.tag_group_id AS "tagGroupId", t.name, t.slug, ${dates('t')}`;

@Injectable()
export class AcademicReadService {
  constructor(private readonly database: DatabaseService) {}

  async groups(request: ReadRequest, rawId?: string) {
    const id = rawId === undefined ? undefined : academicUuid(rawId, request);
    return this.database.readSnapshot(async client => {
      const result = await client.query(`SELECT g.id, g.name, g.code, ${dates('g')} FROM tag_group g ${id ? 'WHERE g.id = $1' : ''}`, id ? [id] : []);
      if (id && !result.rows.length) throw apiError(404, `Không tìm thấy nhóm tag với id: ${id}`, request.path);
      const ids = result.rows.map(row => row.id);
      const tags = ids.length ? (await client.query(`SELECT ${tagFields} FROM tag t WHERE t.tag_group_id = ANY($1::uuid[])`, [ids])).rows : [];
      const rows = result.rows.map(row => ({ ...row, tags: tags.filter(tag => tag.tagGroupId === row.id) }));
      return id ? rows[0] : rows;
    });
  }

  async tags(request: ReadRequest, rawId: string, byGroup: boolean, parameter = 'id') {
    const id = academicUuid(rawId, request, parameter);
    return this.database.readSnapshot(async client => {
      if (byGroup) {
        const group = await client.query('SELECT id FROM tag_group WHERE id = $1', [id]);
        if (!group.rows.length) throw apiError(404, `Không tìm thấy nhóm tag với id: ${id}`, request.path);
      }
      const result = await client.query(`SELECT ${tagFields} FROM tag t WHERE ${byGroup ? 't.tag_group_id' : 't.id'} = $1`, [id]);
      if (!byGroup && !result.rows.length) throw apiError(404, `Không tìm thấy tag với id: ${id}`, request.path);
      return byGroup ? result.rows : result.rows[0];
    });
  }

  async resources(kind: 'stimulus' | 'question_bank', request: ReadRequest, query: Record<string, unknown>, rawId?: string) {
    const id = rawId === undefined ? undefined : academicUuid(rawId, request);
    requireAuthor(request);
    const admin = request.user.roles.includes('ADMIN');
    const bank = kind === 'question_bank';
    const resource = bank ? 'question bank' : 'stimulus';
    const fields = bank
      ? `r.id, r.name, r.description, r.scope, r.status, r.owner_id AS "ownerAccountId", ${dates('r')}`
      : `r.id, r.title, r.content, r.source, r.status, r.created_by AS "createdByAccountId", ${dates('r')}`;
    const { page, size } = parsePaging(query);
    const order = id ? '' : parseSort(query, bank
      ? { id: 'r.id', name: 'r.name', description: 'r.description', scope: 'r.scope', status: 'r.status', createdAt: 'r.created_at', updatedAt: 'r.updated_at', version: 'r.version' }
      : { id: 'r.id', title: 'r.title', source: 'r.source', status: 'r.status', createdAt: 'r.created_at', updatedAt: 'r.updated_at' }, request.path, ['name', 'description', 'title', 'source']);
    return this.database.readSnapshot(async client => {
      const values: unknown[] = [];
      const predicates = bank ? ['r.deleted_at IS NULL'] : ['TRUE'];
      if (id) { values.push(id); predicates.push('r.id = $1'); }
      else if (!admin) { values.push(request.user.id); predicates.push(`r.${bank ? 'owner_id' : 'created_by'} = $1`); }
      const where = predicates.join(' AND ');
      if (id) {
        const row = (await client.query(`SELECT ${fields} FROM ${kind} r WHERE ${where}`, values)).rows[0];
        if (!row) throw apiError(404, `Không tìm thấy ${resource} với id: ${id}`, request.path);
        if (!admin && (bank ? row.scope !== 'TEACHER' || row.ownerAccountId !== request.user.id : row.createdByAccountId !== request.user.id)) {
          throw apiError(403, `Bạn không có quyền truy cập ${resource} này`, request.path);
        }
        return row;
      }
      return this.page(client, `${kind} r`, fields, where, values, order, page, size);
    });
  }

  async page(client: PoolClient, from: string, fields: string, where: string, values: unknown[], order: string, page: number, size: number) {
    const total = Number((await client.query(`SELECT count(*) AS total FROM ${from} WHERE ${where}`, values)).rows[0].total);
    const content = (await client.query(`SELECT ${fields} FROM ${from} WHERE ${where} ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, size, page * size])).rows;
    return { content, page: { size, number: page, totalElements: total, totalPages: Math.ceil(total / size) } };
  }
}
