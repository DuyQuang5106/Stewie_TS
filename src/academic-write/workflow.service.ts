import { Injectable, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { apiError } from '../read-api/auth.guard.js';
import { academicUuid, requireAuthor } from '../read-api/academic.service.js';
import { DatabaseService } from '../database.service.js';
import { QuestionWriteService } from './question.service.js';
import { javaTrim, javaIsBlank } from './question.binding.js';
import type { JsonRecord } from './question.binding.js';
import { importBody, reviewBody } from './workflow.binding.js';
const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .replace(/Z$/, '');
};
@Injectable()
export class AcademicWorkflowService {
  constructor(
    private readonly database: DatabaseService,
    private readonly questions: QuestionWriteService,
  ) {}
  async review(request: ReadRequest, rawId: string, input: unknown) {
    const id = academicUuid(rawId, request, 'versionId');
    const body = reviewBody(input, request);
    if (!request.user.roles.includes('ADMIN'))
      throw apiError(
        403,
        'Bạn không có quyền thực hiện thao tác này',
        request.path,
      );
    if (body.status === 'PENDING')
      throw apiError(
        400,
        'Review decision chỉ được là APPROVED hoặc CHANGES_REQUESTED',
        request.path,
      );
    const comment =
      body.comment === null || javaIsBlank(body.comment)
        ? null
        : javaTrim(body.comment);
    if (body.status === 'CHANGES_REQUESTED' && !comment)
      throw apiError(
        400,
        'CHANGES_REQUESTED bắt buộc có comment',
        request.path,
      );
    return this.database.writeTransaction(async (client) => {
      const version = (
        await client.query('SELECT * FROM question_version WHERE id=$1', [id])
      ).rows[0];
      if (!version)
        throw apiError(
          404,
          `Không tìm thấy QuestionVersion với id: ${id}`,
          request.path,
        );
      const reviewId = randomUUID();
      await client.query(
        'INSERT INTO question_quality_review(id,question_version_id,reviewer_id,status,comment,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [reviewId, id, request.user.id, body.status, comment, new Date()],
      );
      await client.query(
        'UPDATE question_version SET review_status=$2 WHERE id=$1',
        [id, body.status],
      );
      return (
        await client.query(
          `SELECT r.id,v.question_id AS "questionId",v.id AS "questionVersionId",v.version_number AS "versionNumber",r.status,r.comment,
        r.reviewer_id AS "reviewerAccountId",replace(r.created_at::text,' ','T') AS "createdAt" FROM question_quality_review r JOIN question_version v ON v.id=r.question_version_id WHERE r.id=$1`,
          [reviewId],
        )
      ).rows[0];
    });
  }
  private async bank(client: PoolClient, id: string, request: ReadRequest) {
    const bank = (
      await client.query(
        'SELECT * FROM question_bank WHERE id=$1 AND deleted_at IS NULL',
        [id],
      )
    ).rows[0];
    if (!bank)
      throw apiError(
        404,
        `Không tìm thấy question bank với id: ${id}`,
        request.path,
      );
    if (
      !request.user.roles.includes('ADMIN') &&
      (bank.scope !== 'TEACHER' || bank.owner_id !== request.user.id)
    )
      throw apiError(
        403,
        'Bạn không có quyền với question bank này',
        request.path,
      );
    return bank;
  }
  private candidate(document: JsonRecord, item: JsonRecord): JsonRecord {
    return {
      ...item,
      questionBankId: document.targetQuestionBankId,
      tagIds: item.tagIds ?? [],
      topicIds: item.topicIds ?? [],
      skillIds: item.skillIds ?? [],
    };
  }
  async validate(request: ReadRequest, input: unknown) {
    const document = importBody(input, request);
    requireAuthor(request);
    if (document.schemaVersion !== 1)
      throw apiError(
        400,
        'Chỉ hỗ trợ question import schemaVersion=1',
        request.path,
      );
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 1000000)
      throw apiError(
        413,
        'Import payload không được vượt quá 1 MB',
        request.path,
      );
    try {
      return await this.database.writeTransaction(async (client) => {
        const existing = (
          await client.query(
            `SELECT b.id FROM question_import_batch b JOIN question_bank k ON k.id=b.target_question_bank_id AND k.deleted_at IS NULL
          JOIN users u ON u.id=b.created_by AND u.deleted_at IS NULL WHERE b.created_by=$1 AND b.import_key=$2`,
            [request.user.id, javaTrim(document.importKey)],
          )
        ).rows[0];
        if (existing) return this.batchResponse(client, existing.id);
        await this.bank(client, document.targetQuestionBankId, request);
        const seen = new Set();
        const errors: JsonRecord[] = [];
        let validated = 0;
        for (let i = 0; i < document.questions.length; i++) {
          const item = document.questions[i];
          if (!item) throw new Error('Null import item');
          if (seen.has(item.externalId)) {
            errors.push({
              index: i,
              externalId: item.externalId,
              status: 400,
              message: 'externalId bị trùng trong batch',
            });
            continue;
          }
          seen.add(item.externalId);
          try {
            await this.questions.validateCandidate(
              client,
              request,
              this.candidate(document, item),
            );
            validated++;
          } catch (error) {
            if (!(error instanceof HttpException)) throw error;
            errors.push({
              index: i,
              externalId: item.externalId,
              status: error.getStatus(),
              message: (error.getResponse() as { message: string }).message,
            });
          }
        }
        const id = randomUUID();
        await client.query(
          `INSERT INTO question_import_batch(id,schema_version,import_key,target_question_bank_id,created_by,status,payload,validation_errors,total_count,validated_count,created_at)
          VALUES($1,1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`,
          [
            id,
            javaTrim(document.importKey),
            document.targetQuestionBankId,
            request.user.id,
            errors.length ? 'FAILED' : 'VALIDATED',
            JSON.stringify(document),
            JSON.stringify(errors),
            document.questions.length,
            validated,
            new Date(),
          ],
        );
        return this.batchResponse(client, id);
      });
    } catch (error) {
      return this.integrity(error, request);
    }
  }
  private async requireBatch(
    client: PoolClient,
    id: string,
    request: ReadRequest,
  ) {
    const row = (
      await client.query(
        `SELECT b.* FROM question_import_batch b JOIN question_bank k ON k.id=b.target_question_bank_id AND k.deleted_at IS NULL
      JOIN users u ON u.id=b.created_by AND u.deleted_at IS NULL WHERE b.id=$1`,
        [id],
      )
    ).rows[0];
    if (!row)
      throw apiError(
        404,
        `Không tìm thấy import batch với id: ${id}`,
        request.path,
      );
    return row;
  }
  async getBatch(request: ReadRequest, rawId: string) {
    const id = academicUuid(rawId, request, 'batchId');
    requireAuthor(request);
    return this.database.readSnapshot(async (client) => {
      const row = await this.requireBatch(client, id, request);
      if (
        row.created_by !== request.user.id &&
        !request.user.roles.includes('ADMIN')
      )
        throw apiError(
          403,
          'Bạn không có quyền xem import batch này',
          request.path,
        );
      return this.batchResponse(client, id);
    });
  }
  async commit(request: ReadRequest, rawId: string) {
    const id = academicUuid(rawId, request, 'batchId');
    requireAuthor(request);
    try {
      return await this.database.writeTransaction(async (client) => {
        const row = await this.requireBatch(client, id, request);
        if (row.created_by !== request.user.id)
          throw apiError(
            403,
            'Bạn không sở hữu import batch này',
            request.path,
          );
        if (row.status === 'COMMITTED') return this.batchResponse(client, id);
        if (row.status !== 'VALIDATED')
          throw apiError(
            409,
            'Chỉ import batch VALIDATED mới có thể commit',
            request.path,
          );
        const created: string[] = [];
        for (const item of row.payload.questions) {
          const result = await this.questions.createInTransaction(
            client,
            request,
            this.candidate(row.payload, item),
          );
          created.push(result!.id);
        }
        await client.query(
          "UPDATE question_import_batch SET status='COMMITTED',created_question_ids=$2::jsonb,committed_at=$3 WHERE id=$1",
          [id, JSON.stringify(created), new Date()],
        );
        return this.batchResponse(client, id);
      });
    } catch (error) {
      return this.integrity(error, request);
    }
  }
  private integrity(error: unknown, request: ReadRequest): never {
    if ((error as { code?: string }).code?.startsWith('23'))
      throw apiError(
        409,
        'Dữ liệu bị trùng hoặc đang được sử dụng',
        request.path,
      );
    throw error;
  }
  private async batchResponse(client: PoolClient, id: string) {
    return (
      await client.query(
        `SELECT id,schema_version AS "schemaVersion",import_key AS "importKey",target_question_bank_id AS "targetQuestionBankId",status,total_count AS "totalCount",validated_count AS "validatedCount",
      validation_errors AS errors,coalesce(created_question_ids,'[]'::jsonb) AS "createdQuestionIds",replace(created_at::text,' ','T') AS "createdAt",replace(committed_at::text,' ','T') AS "committedAt" FROM question_import_batch WHERE id=$1`,
        [id],
      )
    ).rows[0];
  }
  async export(request: ReadRequest, query: Record<string, unknown>) {
    if (query.questionBankId === undefined || query.questionBankId === '')
      throw apiError(
        400,
        "Required parameter 'questionBankId' is not present.",
        request.path,
      );
    const id = academicUuid(
      String(query.questionBankId),
      request,
      'questionBankId',
    );
    const status =
      query.status === undefined || !String(query.status).trim()
        ? null
        : String(query.status).trim();
    if (status && !['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status))
      throw apiError(
        400,
        "Tham số 'status' không đúng định dạng",
        request.path,
      );
    requireAuthor(request);
    return this.database.readSnapshot(async (client) => {
      await this.bank(client, id, request);
      const values: unknown[] = [id];
      let where = 'q.question_bank_id=$1 AND q.deleted_at IS NULL';
      if (status) {
        values.push(status);
        where += ` AND q.status=$${values.length}`;
      }
      if (!request.user.roles.includes('ADMIN')) {
        values.push(request.user.id);
        where += ` AND q.owner_id=$${values.length}`;
      }
      const rows = (
        await client.query(
          `SELECT q.id FROM question q JOIN users u ON u.id=q.created_by AND u.deleted_at IS NULL WHERE ${where} ORDER BY q.created_at LIMIT 1001`,
          values,
        )
      ).rows;
      if (rows.length > 1000)
        throw apiError(
          413,
          'Export không được vượt quá 1000 questions',
          request.path,
        );
      const questions = [];
      for (const row of rows) {
        const q = await this.questions.response(client, row.id);
        questions.push({
          externalId: q.id,
          stimulusId: q.stimulusId,
          questionType: q.questionType,
          difficulty: q.difficulty,
          content: q.content,
          answer: q.answer,
          explanation: q.explanation,
          topicIds: q.topicIds,
          skillIds: q.skillIds,
          tagIds: q.tagIds,
        });
      }
      return {
        schemaVersion: 1,
        exportedAt: localNow(),
        sourceQuestionBankId: id,
        questions,
      };
    });
  }
}
