import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { apiError } from '../read-api/auth.guard.js';
import { academicUuid, dates } from '../read-api/academic.service.js';

type Kind = 'topic' | 'skill' | 'tag_group' | 'tag';
type CatalogBody = {
  name: string;
  slug?: string;
  code?: string;
  tagGroupId?: string;
};
const javaTrim = (value: string) => {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 32) start++;
  while (end > start && value.charCodeAt(end - 1) <= 32) end--;
  return value.slice(start, end);
};

// Java ignores unknown JSON properties and coerces scalar values to String.
// Validation is intentionally scoped to these Java DTOs, not the global Nest DTO policy.
export function catalogBody(
  kind: Kind,
  input: unknown,
  request: ReadRequest,
  create: boolean,
): CatalogBody {
  // Java's current catch-all maps HttpMessageNotReadableException to 500.
  const unreadable = () => new Error('Unreadable catalog request');
  if (request.headers['content-length'] === '0') throw unreadable();
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw unreadable();
  const raw = input as Record<string, unknown>;
  const group = kind === 'tag_group';
  const classification = kind === 'topic' || kind === 'skill';
  const key = group ? 'code' : 'slug';
  const errors: Record<string, string> = {};
  const values: Record<string, string> = {};
  for (const field of ['name', key]) {
    const value = raw[field];
    if (value !== null && value !== undefined && typeof value === 'object')
      throw unreadable();
    const text =
      value === null || value === undefined ? undefined : String(value);
    if (text !== undefined) values[field] = text;
    const max = group ? 50 : 100;
    if (text === undefined || !text.trim()) {
      errors[field] = classification
        ? 'must not be blank'
        : field === 'name'
          ? group
            ? 'Tên nhóm tag không được để trống'
            : 'Tên tag không được để trống'
          : group
            ? 'Mã nhóm tag không được để trống'
            : 'Slug của tag không được để trống';
    } else if (text.length > max) {
      errors[field] = classification
        ? 'size must be between 0 and 100'
        : field === 'name'
          ? group
            ? 'Tên nhóm tag không được vượt quá 50 ký tự'
            : 'Tên tag không được vượt quá 100 ký tự'
          : group
            ? 'Mã nhóm tag không được vượt quá 50 ký tự'
            : 'Slug không được vượt quá 100 ký tự';
    } else if (
      field === key &&
      !(
        group
          ? /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/
          : /^[a-z0-9]+(?:-[a-z0-9]+)*$/
      ).test(text)
    ) {
      errors[field] = classification
        ? 'slug chỉ gồm chữ thường, số và dấu gạch ngang'
        : group
          ? 'Mã nhóm chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới'
          : 'Slug chỉ gồm chữ thường, số và dấu gạch ngang';
    }
  }
  if (kind === 'tag' && create) {
    if (raw.tagGroupId === null || raw.tagGroupId === undefined)
      errors.tagGroupId = 'tagGroupId không được để trống';
    else {
      try {
        values.tagGroupId = academicUuid(
          String(raw.tagGroupId),
          request,
          'tagGroupId',
        );
      } catch {
        throw unreadable();
      }
    }
  }
  if (Object.keys(errors).length)
    throw new HttpException(
      {
        ...(apiError(
          400,
          'Dữ liệu đầu vào không hợp lệ',
          request.path,
        ).getResponse() as object),
        fieldErrors: errors,
      },
      400,
    );
  return values as CatalogBody;
}

@Injectable()
export class CatalogWriteService {
  constructor(private readonly database: DatabaseService) {}

  async write(
    kind: Kind,
    action: 'create' | 'update' | 'archive' | 'restore' | 'delete',
    request: ReadRequest,
    rawId?: string,
    input?: unknown,
  ) {
    // Spring binds path/body and validates before invoking method-level @PreAuthorize.
    const id = rawId === undefined ? undefined : academicUuid(rawId, request);
    const body =
      action === 'create' || action === 'update'
        ? catalogBody(kind, input, request, action === 'create')
        : undefined;
    if (!request.user.roles.includes('ADMIN'))
      throw apiError(
        403,
        'Bạn không có quyền thực hiện thao tác này',
        request.path,
      );
    const label = kind === 'topic' ? 'Topic' : 'Skill';
    const classification = kind === 'topic' || kind === 'skill';
    const conflictMessage =
      kind === 'tag_group'
        ? `Mã nhóm tag '${body?.code?.toUpperCase()}' đã tồn tại`
        : kind === 'tag'
          ? `Slug tag '${body?.slug?.toLowerCase()}' đã tồn tại`
          : `${label} slug đã tồn tại`;
    try {
      return await this.database.writeTransaction(async (client) => {
        let row: Record<string, unknown> | undefined;
        if (id) {
          row = (
            await client.query(`SELECT * FROM ${kind} WHERE id = $1`, [id])
          ).rows[0];
          const resource = kind === 'tag_group' ? 'nhóm tag' : kind;
          if (!row)
            throw apiError(
              404,
              `Không tìm thấy ${resource} với id: ${id}`,
              request.path,
            );
        }
        if (action === 'delete') {
          // Java's orphanRemoval/cascade removes all unreferenced child tags atomically.
          if (kind === 'tag_group')
            await client.query('DELETE FROM tag WHERE tag_group_id = $1', [id]);
          await client.query(`DELETE FROM ${kind} WHERE id = $1`, [id]);
          return undefined;
        }
        if (classification && row) {
          if (action === 'restore' && row.status !== 'ARCHIVED')
            throw apiError(
              409,
              `Chỉ ${label} đã archive mới có thể restore`,
              request.path,
            );
          if (action !== 'restore' && row.status !== 'ACTIVE')
            throw apiError(409, `${label} đã archive`, request.path);
        }
        let resultId = id;
        if (body) {
          const name = javaTrim(body.name);
          const key = kind === 'tag_group' ? 'code' : 'slug';
          const value =
            kind === 'tag_group'
              ? javaTrim(body.code!).toUpperCase()
              : javaTrim(body.slug!).toLowerCase();
          if (kind === 'tag' && action === 'create') {
            const parent = await client.query(
              'SELECT id FROM tag_group WHERE id = $1',
              [body.tagGroupId],
            );
            if (!parent.rowCount)
              throw apiError(
                404,
                `Không tìm thấy nhóm tag với id: ${body.tagGroupId}`,
                request.path,
              );
          }
          const duplicate = await client.query(
            `SELECT id FROM ${kind} WHERE ${classification ? `lower(${key}) = lower($1)` : `${key} = $1`} AND ($2::uuid IS NULL OR id <> $2)`,
            [value, id ?? null],
          );
          if (duplicate.rowCount)
            throw apiError(409, conflictMessage, request.path);
          if (action === 'create') {
            resultId = randomUUID();
            const extraColumn = classification
              ? ', status'
              : kind === 'tag'
                ? ', tag_group_id'
                : '';
            const extraValue = classification
              ? ", 'ACTIVE'"
              : kind === 'tag'
                ? ', $5'
                : '';
            await client.query(
              `INSERT INTO ${kind}(id, name, ${key}, created_at, updated_at${extraColumn}) VALUES($1, $2, $3, $4, $4${extraValue})`,
              kind === 'tag'
                ? [resultId, name, value, new Date(), body.tagGroupId]
                : [resultId, name, value, new Date()],
            );
          } else if (row!.name !== name || row![key] !== value) {
            await client.query(
              `UPDATE ${kind} SET name = $2, ${key} = $3, updated_at = $4 WHERE id = $1`,
              [id, name, value, new Date()],
            );
          }
        } else {
          await client.query(
            `UPDATE ${kind} SET status = $2, updated_at = $3 WHERE id = $1`,
            [id, action === 'archive' ? 'ARCHIVED' : 'ACTIVE', new Date()],
          );
        }
        return this.response(client, kind, resultId!);
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code?.startsWith('23'))
        throw apiError(
          409,
          action === 'delete'
            ? kind === 'tag_group'
              ? 'Không thể xóa nhóm tag đang được sử dụng'
              : 'Không thể xóa tag đang được sử dụng'
            : conflictMessage,
          request.path,
        );
      throw error;
    }
  }

  private async response(client: PoolClient, kind: Kind, id: string) {
    const fields =
      kind === 'tag_group'
        ? 'r.code'
        : kind === 'tag'
          ? 'r.slug, r.tag_group_id AS "tagGroupId"'
          : 'r.slug, r.status';
    const row = (
      await client.query(
        `SELECT r.id, r.name, ${fields}, ${dates('r')} FROM ${kind} r WHERE r.id = $1`,
        [id],
      )
    ).rows[0];
    if (kind === 'tag_group')
      row.tags = (
        await client.query(
          `SELECT r.id, r.name, r.slug, r.tag_group_id AS "tagGroupId", ${dates('r')} FROM tag r WHERE r.tag_group_id = $1`,
          [id],
        )
      ).rows;
    return row;
  }
}
