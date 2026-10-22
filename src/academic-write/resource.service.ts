import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseService } from '../database.service.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { apiError } from '../read-api/auth.guard.js';
import {
  academicUuid,
  dates,
  requireAuthor,
} from '../read-api/academic.service.js';

type Kind = 'stimulus' | 'question_bank';
type Action = 'create' | 'update' | 'publish' | 'archive' | 'restore';
interface ResourceBody {
  name: string;
  optional: string | null;
  content?: unknown;
  scope?: string;
  ownerId?: string | null;
}
const javaTrim = (text: string) => {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 32) start++;
  while (end > start && text.charCodeAt(end - 1) <= 32) end--;
  return text.slice(start, end);
};
const unreadable = () => new Error('Unreadable resource request');

function resourceBody(
  kind: Kind,
  input: unknown,
  create: boolean,
  request: ReadRequest,
): ResourceBody {
  if (
    request.headers['content-length'] === '0' ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  )
    throw unreadable();
  const raw = input as Record<string, unknown>;
  const stimulus = kind === 'stimulus';
  const errors: Record<string, string> = {};
  const string = (key: string) => {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') throw unreadable();
    return String(value);
  };
  const nameKey = stimulus ? 'title' : 'name';
  const optionalKey = stimulus ? 'source' : 'description';
  const name = string(nameKey);
  const optional = string(optionalKey);
  if (name === null || !name.trim())
    errors[nameKey] = stimulus
      ? 'must not be blank'
      : 'Tên question bank không được để trống';
  else if (name.length > 255)
    errors[nameKey] = stimulus
      ? 'size must be between 0 and 255'
      : 'Tên question bank không được vượt quá 255 ký tự';
  if (optional !== null && optional.length > 1000)
    errors[optionalKey] = stimulus
      ? 'size must be between 0 and 1000'
      : 'Mô tả không được vượt quá 1000 ký tự';
  let scope: string | undefined;
  let ownerId: string | null = null;
  if (stimulus) {
    if (!Object.hasOwn(raw, 'content')) errors.content = 'must not be null';
  } else if (create) {
    if (raw.scope === null || raw.scope === undefined)
      errors.scope = 'Scope không được để trống';
    else if (
      typeof raw.scope === 'number' &&
      Number.isInteger(raw.scope) &&
      [0, 1].includes(raw.scope)
    )
      scope = ['SYSTEM', 'TEACHER'][raw.scope];
    else if (
      typeof raw.scope === 'string' &&
      ['SYSTEM', 'TEACHER'].includes(raw.scope.trim())
    )
      scope = raw.scope.trim();
    else throw unreadable();
    if (raw.ownerAccountId !== null && raw.ownerAccountId !== undefined) {
      if (typeof raw.ownerAccountId !== 'string') throw unreadable();
      let rawOwner = raw.ownerAccountId.trim();
      if (/^[A-Za-z0-9+/]{22}==$/.test(rawOwner)) {
        const hex = Buffer.from(rawOwner, 'base64').toString('hex');
        rawOwner = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
      if (rawOwner) {
        if (rawOwner.length !== 36) throw unreadable();
        try {
          ownerId = academicUuid(rawOwner, request, 'ownerAccountId');
        } catch {
          throw unreadable();
        }
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
  return {
    name: javaTrim(name!),
    optional: optional === null || !optional.trim() ? null : javaTrim(optional),
    content: raw.content,
    scope,
    ownerId,
  };
}

@Injectable()
export class ResourceWriteService {
  constructor(private readonly database: DatabaseService) {}

  async write(
    kind: Kind,
    action: Action,
    request: ReadRequest,
    rawId?: string,
    input?: unknown,
  ) {
    const id = rawId === undefined ? undefined : academicUuid(rawId, request);
    const body =
      action === 'create' || action === 'update'
        ? resourceBody(kind, input, action === 'create', request)
        : undefined;
    requireAuthor(request);
    const admin = request.user.roles.includes('ADMIN');
    const stimulus = kind === 'stimulus';
    try {
      return await this.database.writeTransaction(async (client) => {
        const row = id
          ? (
              await client.query(
                `SELECT *,replace(created_at::text,' ','T') AS "originalCreatedAt",replace(updated_at::text,' ','T') AS "originalUpdatedAt" FROM ${kind} WHERE id = $1 ${stimulus ? '' : 'AND deleted_at IS NULL'}`,
                [id],
              )
            ).rows[0]
          : undefined;
        if (id && !row)
          throw apiError(
            404,
            `Không tìm thấy ${stimulus ? 'stimulus' : 'question bank'} với id: ${id}`,
            request.path,
          );
        if (
          row &&
          !admin &&
          (stimulus
            ? row.created_by !== request.user.id
            : row.scope !== 'TEACHER' || row.owner_id !== request.user.id)
        ) {
          throw apiError(
            403,
            `Bạn không có quyền truy cập ${stimulus ? 'stimulus' : 'question bank'} này`,
            request.path,
          );
        }
        let ownerId: string | null = row?.owner_id ?? null;
        if (!stimulus && action === 'create') {
          if (!admin) {
            if (body!.scope !== 'TEACHER')
              throw apiError(
                403,
                'Teacher chỉ có thể tạo TEACHER question bank',
                request.path,
              );
            if (body!.ownerId && body!.ownerId !== request.user.id)
              throw apiError(
                403,
                'Teacher không thể tạo question bank cho người khác',
                request.path,
              );
            ownerId = request.user.id;
          } else if (body!.scope === 'SYSTEM') {
            if (body!.ownerId)
              throw apiError(
                400,
                'SYSTEM question bank không có human owner',
                request.path,
              );
          } else {
            if (!body!.ownerId)
              throw apiError(
                400,
                'TEACHER question bank phải có ownerAccountId',
                request.path,
              );
            const owner = await client.query(
              `SELECT u.id, EXISTS(SELECT 1 FROM user_roles WHERE user_id = u.id AND role = 'TEACHER') AS teacher
              FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
              [body!.ownerId],
            );
            if (!owner.rowCount)
              throw apiError(404, 'Không tìm thấy owner account', request.path);
            if (!owner.rows[0].teacher)
              throw apiError(
                400,
                'Owner account phải có role TEACHER',
                request.path,
              );
            ownerId = body!.ownerId!;
          }
        }
        let status = row?.status ?? (stimulus ? 'DRAFT' : 'ACTIVE');
        if (row) {
          let message: string | undefined;
          if (action === 'update' && status !== (stimulus ? 'DRAFT' : 'ACTIVE'))
            message = stimulus
              ? 'Chỉ stimulus DRAFT mới có thể chỉnh sửa'
              : 'Question bank đã archive và không thể chỉnh sửa';
          if (action === 'publish' && status !== 'DRAFT')
            message = 'Chỉ stimulus DRAFT mới có thể publish';
          if (action === 'archive' && status === 'ARCHIVED')
            message = stimulus
              ? 'Stimulus đã được archive'
              : 'Question bank đã được archive';
          if (action === 'restore' && status !== 'ARCHIVED')
            message = stimulus
              ? 'Chỉ stimulus ARCHIVED mới có thể restore'
              : 'Chỉ question bank đã archive mới có thể restore';
          if (message) throw apiError(409, message, request.path);
        }
        const content = body ? body.content : row?.content;
        if (stimulus && ['create', 'update', 'publish'].includes(action)) {
          if (
            content === null ||
            typeof content !== 'object' ||
            Array.isArray(content) ||
            !Object.keys(content).length
          )
            throw apiError(
              400,
              'content phải là JSON object không rỗng',
              request.path,
            );
          if (JSON.stringify(content).length > 100000)
            throw apiError(
              400,
              'content không được vượt quá 100000 ký tự JSON',
              request.path,
            );
        }
        if (!stimulus && body) {
          const scope = row?.scope ?? body.scope;
          const duplicate = await client.query(
            `SELECT id FROM question_bank WHERE deleted_at IS NULL AND lower(name) = lower($1)
            AND ($2::uuid IS NULL OR id <> $2) AND ${scope === 'SYSTEM' ? "scope = 'SYSTEM'" : 'owner_id = $3'}`,
            scope === 'SYSTEM'
              ? [body.name, id ?? null]
              : [body.name, id ?? null, ownerId],
          );
          if (duplicate.rowCount)
            throw apiError(
              409,
              'Question bank cùng tên đã tồn tại',
              request.path,
            );
        }
        if (action === 'publish') status = 'PUBLISHED';
        if (action === 'archive') status = 'ARCHIVED';
        if (action === 'restore') status = stimulus ? 'DRAFT' : 'ACTIVE';
        const resultId = id ?? randomUUID();
        if (!row) {
          if (stimulus)
            await client.query(
              `INSERT INTO stimulus(id,title,content,source,status,created_by,created_at,updated_at)
            VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$7)`,
              [
                resultId,
                body!.name,
                JSON.stringify(content),
                body!.optional,
                status,
                request.user.id,
                new Date(),
              ],
            );
          else
            await client.query(
              `INSERT INTO question_bank(id,name,description,scope,status,owner_id,version,created_at,updated_at)
            VALUES($1,$2,$3,$4,$5,$6,0,$7,$7)`,
              [
                resultId,
                body!.name,
                body!.optional,
                body!.scope,
                status,
                ownerId,
                new Date(),
              ],
            );
        } else {
          const name = body?.name ?? row[stimulus ? 'title' : 'name'];
          const optional = body
            ? body.optional
            : row[stimulus ? 'source' : 'description'];
          const changed =
            row.status !== status ||
            row[stimulus ? 'title' : 'name'] !== name ||
            row[stimulus ? 'source' : 'description'] !== optional ||
            (stimulus && !isDeepStrictEqual(row.content, content));
          if (changed) {
            if (stimulus)
              await client.query(
                `UPDATE stimulus SET title=$2,content=$3::jsonb,source=$4,status=$5,updated_at=$6 WHERE id=$1`,
                [
                  id,
                  name,
                  JSON.stringify(content),
                  optional,
                  status,
                  new Date(),
                ],
              );
            else {
              const updated = await client.query(
                `UPDATE question_bank SET name=$2,description=$3,status=$4,updated_at=$5,version=version+1 WHERE id=$1 AND version=$6`,
                [id, name, optional, status, new Date(), row.version],
              );
              if (!updated.rowCount)
                throw apiError(
                  409,
                  'Dữ liệu đã được cập nhật bởi yêu cầu khác; hãy tải lại trước khi thử lại',
                  request.path,
                );
            }
          }
        }
        const fields = stimulus
          ? 'r.title,r.content,r.source,r.created_by AS "createdByAccountId"'
          : 'r.name,r.description,r.scope,r.owner_id AS "ownerAccountId"';
        const response = (
          await client.query(
            `SELECT r.id,${fields},r.status,${dates('r')} FROM ${kind} r WHERE r.id=$1`,
            [resultId],
          )
        ).rows[0];
        // These Java services construct their DTO before Hibernate flushes timestamp changes.
        if (stimulus && !row) {
          response.createdAt = null;
          response.updatedAt = null;
        } else if (stimulus || action === 'archive' || action === 'restore') {
          response.createdAt = row.originalCreatedAt;
          response.updatedAt = row.originalUpdatedAt;
        }
        return response;
      });
    } catch (error) {
      if (!stimulus && (error as { code?: string }).code?.startsWith('23'))
        throw apiError(409, 'Question bank cùng tên đã tồn tại', request.path);
      throw error;
    }
  }
}
