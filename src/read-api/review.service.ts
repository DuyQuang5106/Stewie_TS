import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import type { ReadRequest } from './auth.guard.js';
import { apiError } from './auth.guard.js';
import { academicUuid, requireAuthor } from './academic.service.js';
import { parsePaging, parseSort } from './paging.js';

@Injectable()
export class ReviewReadService {
  constructor(private readonly database: DatabaseService) {}

  async history(request: ReadRequest, rawId: string) {
    const id = academicUuid(rawId, request, 'versionId');
    requireAuthor(request);
    return this.database.readSnapshot(async (client) => {
      const version = (
        await client.query(
          `SELECT q.owner_id, q.deleted_at FROM question_version v
        JOIN question q ON q.id = v.question_id WHERE v.id = $1`,
          [id],
        )
      ).rows[0];
      if (!version)
        throw apiError(
          404,
          `Không tìm thấy QuestionVersion với id: ${id}`,
          request.path,
        );
      // Java lazily resolves the deleted question when checking a teacher's owner access.
      if (version.deleted_at && !request.user.roles.includes('ADMIN'))
        throw new Error('Review question unavailable');
      if (
        !request.user.roles.includes('ADMIN') &&
        version.owner_id !== request.user.id
      ) {
        throw apiError(403, 'Bạn không có quyền xem review này', request.path);
      }
      const history = (
        await client.query(
          `SELECT r.id, v.question_id AS "questionId",
        v.id AS "questionVersionId", v.version_number AS "versionNumber", r.status, r.comment,
        r.reviewer_id AS "reviewerAccountId", replace(r.created_at::text, ' ', 'T') AS "createdAt"
        FROM question_quality_review r JOIN question_version v ON v.id = r.question_version_id
        WHERE v.id = $1 ORDER BY r.created_at DESC`,
          [id],
        )
      ).rows;
      // Java's review repository also resolves the deleted question for nonempty history.
      if (version.deleted_at && history.length)
        throw new Error('Review question unavailable');
      return history;
    });
  }

  async queue(request: ReadRequest, query: Record<string, unknown>) {
    const raw = query.status === undefined ? 'PENDING' : String(query.status);
    const status = raw.trim() || 'PENDING';
    if (!['PENDING', 'APPROVED', 'CHANGES_REQUESTED'].includes(status)) {
      throw apiError(
        400,
        "Tham số 'status' không đúng định dạng",
        request.path,
      );
    }
    requireAuthor(request);
    const { page, size } = parsePaging(query);
    const columns = {
      publishedAt: 'v.published_at',
      versionNumber: 'v.version_number',
      reviewStatus: 'v.review_status',
    };
    // Java rejects unsupported properties with its service-specific message.
    for (const sort of Array.isArray(query.sort) ? query.sort : [query.sort]) {
      if (typeof sort !== 'string') continue;
      const parts = sort.split(',').filter(Boolean);
      if (parts.at(-1)?.toLowerCase() === 'ignorecase') parts.pop();
      if (['asc', 'desc'].includes(parts.at(-1)?.toLowerCase() ?? ''))
        parts.pop();
      for (const property of parts)
        if (!Object.hasOwn(columns, property)) {
          throw apiError(
            400,
            `Review sort field không được hỗ trợ: ${property}`,
            request.path,
          );
        }
    }
    const order = parseSort(query, columns, request.path, []);
    return this.database.readSnapshot(async (client) => {
      const values: unknown[] = [status];
      let where = 'v.review_status = $1 AND q.deleted_at IS NULL';
      if (!request.user.roles.includes('ADMIN')) {
        values.push(request.user.id);
        where += ' AND q.owner_id = $2';
      }
      const content = (
        await client.query(
          `SELECT q.id AS "questionId", v.id AS "questionVersionId",
        v.version_number AS "versionNumber", q.question_bank_id AS "questionBankId",
        v.review_status AS "reviewStatus", replace(v.published_at::text, ' ', 'T') AS "publishedAt"
        FROM question_version v JOIN question q ON q.id = v.question_id WHERE ${where}
        ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, size, page * size],
        )
      ).rows;
      // Spring skips the derived count query for a nonempty partial page (or an empty first page).
      // Admin's derived count has no question join, even though the entity graph filters deleted questions.
      let total: number;
      if (content.length < size && (page === 0 || content.length > 0))
        total = page * size + content.length;
      else {
        const from = request.user.roles.includes('ADMIN')
          ? 'question_version v'
          : 'question_version v JOIN question q ON q.id = v.question_id';
        const countWhere = request.user.roles.includes('ADMIN')
          ? 'v.review_status = $1'
          : where;
        total = Number(
          (
            await client.query(
              `SELECT count(*) AS total FROM ${from} WHERE ${countWhere}`,
              values,
            )
          ).rows[0].total,
        );
        if (content.length > 0 && page * size + size > total)
          total = page * size + content.length;
      }
      return {
        content,
        page: {
          size,
          number: page,
          totalElements: total,
          totalPages: Math.ceil(total / size),
        },
      };
    });
  }
}
