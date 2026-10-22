import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { apiError } from '../read-api/auth.guard.js';
import {
  academicUuid,
  dates,
  requireAuthor,
} from '../read-api/academic.service.js';
import {
  javaTrim,
  questionBody,
  validateAggregate,
} from './question.binding.js';
import type { JsonRecord } from './question.binding.js';

type Action =
  | 'validate'
  | 'create'
  | 'update'
  | 'publish'
  | 'revise'
  | 'archive'
  | 'restore'
  | 'duplicate'
  | 'transfer-ownership';
const conflict =
  'Dữ liệu đã được cập nhật bởi yêu cầu khác; hãy tải lại trước khi thử lại';
@Injectable()
export class QuestionWriteService {
  constructor(private readonly database: DatabaseService) {}
  async write(
    action: Action,
    request: ReadRequest,
    rawId?: string,
    input?: unknown,
  ) {
    const id = rawId === undefined ? undefined : academicUuid(rawId, request);
    const body = [
      'create',
      'update',
      'publish',
      'duplicate',
      'transfer-ownership',
    ].includes(action)
      ? questionBody(action, input, request)
      : undefined;
    requireAuthor(request);
    if (
      action === 'transfer-ownership' &&
      !request.user.roles.includes('ADMIN')
    )
      throw apiError(
        403,
        'Bạn không có quyền thực hiện thao tác này',
        request.path,
      );
    try {
      return await this.database.writeTransaction((client) =>
        this.execute(client, action, request, id, body),
      );
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith('23'))
        throw apiError(
          409,
          'Dữ liệu bị trùng hoặc đang được sử dụng',
          request.path,
        );
      throw error;
    }
  }
  async createInTransaction(
    client: PoolClient,
    request: ReadRequest,
    body: JsonRecord,
  ) {
    return this.execute(client, 'create', request, undefined, body);
  }
  async validateCandidate(
    client: PoolClient,
    request: ReadRequest,
    body: JsonRecord,
  ) {
    return this.execute(client, 'validate', request, undefined, body);
  }
  private async execute(
    client: PoolClient,
    action: Action,
    request: ReadRequest,
    id: string | undefined,
    body: JsonRecord | undefined,
  ) {
    const fail = (status: number, message: string): never => {
      throw apiError(status, message, request.path);
    };

    const q = id
      ? (
          await client.query(
            `SELECT * FROM question WHERE id=$1 AND deleted_at IS NULL`,
            [id],
          )
        ).rows[0]
      : undefined;
    if (id && !q) fail(404, `Không tìm thấy question với id: ${id}`);
    if (
      q &&
      action !== 'transfer-ownership' &&
      !request.user.roles.includes('ADMIN') &&
      q.owner_id !== request.user.id
    )
      fail(403, 'Bạn không có quyền truy cập question này');
    const bank = async (bankId: string) => {
      const row = (
        await client.query(
          'SELECT * FROM question_bank WHERE id=$1 AND deleted_at IS NULL',
          [bankId],
        )
      ).rows[0];
      if (!row) fail(404, `Không tìm thấy question bank với id: ${bankId}`);
      if (row.status !== 'ACTIVE')
        fail(409, 'Không thể tạo question trong question bank đã archive');
      if (
        !request.user.roles.includes('ADMIN') &&
        (row.scope !== 'TEACHER' || row.owner_id !== request.user.id)
      )
        fail(403, 'Bạn không có quyền tạo question trong question bank này');
      return row;
    };
    const stimulus = async (stimulusId: string | null) => {
      if (!stimulusId) return null;
      const row = (
        await client.query('SELECT * FROM stimulus WHERE id=$1', [stimulusId])
      ).rows[0];
      if (!row) fail(404, `Không tìm thấy stimulus với id: ${stimulusId}`);
      if (row.status === 'ARCHIVED')
        fail(409, 'Không thể gắn archived stimulus vào question');
      if (
        !request.user.roles.includes('ADMIN') &&
        row.created_by !== request.user.id
      )
        fail(403, 'Bạn không có quyền sử dụng stimulus này');
      return row;
    };
    const resolve = async (
      resource: 'tag' | 'topic' | 'skill',
      ids: (string | null)[],
    ) => {
      if (!ids.length) return;
      const rows = (
        await client.query(
          `SELECT * FROM ${resource} WHERE id=ANY($1::uuid[])`,
          [ids],
        )
      ).rows;
      const found = new Set(rows.map((row) => row.id));
      const missing = ids.find((value) => !found.has(value));
      if (rows.length !== ids.length) {
        if (missing === null) throw new Error('Null relationship identifier');
        fail(404, `Không tìm thấy ${resource} với id: ${missing}`);
      }
      if (resource !== 'tag' && rows.some((row) => row.status !== 'ACTIVE'))
        fail(409, `Không thể gắn archived ${resource} vào question`);
    };
    const relationships = async (questionId: string, values: JsonRecord) => {
      for (const key of ['tag', 'topic', 'skill']) {
        await client.query(`DELETE FROM question_${key} WHERE question_id=$1`, [
          questionId,
        ]);
        for (const relation of values[key + 'Ids'])
          await client.query(
            `INSERT INTO question_${key}(question_id,${key}_id) VALUES($1,$2)`,
            [questionId, relation],
          );
      }
    };
    const insert = async (values: JsonRecord, target: JsonRecord) => {
      const newId = randomUUID();
      const now = new Date();
      await client.query(
        `INSERT INTO question(id,question_bank_id,stimulus_id,question_type,difficulty,status,content,created_by,owner_id,version,created_at,updated_at)
            VALUES($1,$2,$3,$4,$5,'DRAFT',$6::jsonb,$7,$8,0,$9,$9)`,
        [
          newId,
          target.id,
          values.stimulusId,
          values.questionType,
          values.difficulty,
          JSON.stringify(values.content),
          request.user.id,
          target.scope === 'TEACHER' ? target.owner_id : null,
          now,
        ],
      );
      await client.query(
        'INSERT INTO question_answer(question_id,answer,explanation,created_at,updated_at) VALUES($1,$2::jsonb,$3::jsonb,$4,$4)',
        [
          newId,
          JSON.stringify(values.answer),
          JSON.stringify(values.explanation),
          now,
        ],
      );
      await relationships(newId, values);
      return newId;
    };
    let resultId = id!;
    if (action === 'create' || action === 'validate') {
      validateAggregate(
        body!.questionType,
        body!.content,
        body!.answer,
        request,
      );
      const target = await bank(body!.questionBankId);
      await stimulus(body!.stimulusId);
      for (const key of ['tag', 'topic', 'skill'] as const)
        await resolve(key, body![key + 'Ids']);
      if (action === 'validate') return undefined;
      resultId = await insert(body!, target);
    } else if (action === 'duplicate') {
      const target = await bank(body!.targetQuestionBankId);
      if (q.stimulus_id) {
        const row = (
          await client.query('SELECT status FROM stimulus WHERE id=$1', [
            q.stimulus_id,
          ])
        ).rows[0];
        if (row?.status === 'ARCHIVED')
          fail(
            409,
            'Không thể duplicate question đang tham chiếu archived stimulus',
          );
      }
      const source = await this.response(client, id!);
      const rawAnswer = (
        await client.query(
          'SELECT answer,explanation FROM question_answer WHERE question_id=$1',
          [id],
        )
      ).rows[0];
      resultId = await insert(
        {
          stimulusId: q.stimulus_id,
          questionType: q.question_type,
          difficulty: q.difficulty,
          content: q.content,
          answer: rawAnswer.answer,
          explanation: rawAnswer.explanation,
          tagIds: source.tagIds,
          topicIds: source.topicIds,
          skillIds: source.skillIds,
        },
        target,
      );
    } else if (action === 'update') {
      if (q.status !== 'DRAFT')
        fail(409, 'Chỉ question DRAFT mới có thể chỉnh sửa');
      validateAggregate(
        body!.questionType,
        body!.content,
        body!.answer,
        request,
      );
      await stimulus(body!.stimulusId);
      for (const key of ['tag', 'topic', 'skill'] as const)
        await resolve(key, body![key + 'Ids']);
      const prior = (
        await client.query(
          'SELECT answer,explanation FROM question_answer WHERE question_id=$1',
          [id],
        )
      ).rows[0];
      // Java replaces all three Hibernate collection wrappers on every update.
      // This dirties the versioned aggregate even when the relation IDs are unchanged.
      const update = await client.query(
        'UPDATE question SET stimulus_id=$2,question_type=$3,difficulty=$4,content=$5::jsonb,version=version+1,updated_at=$6 WHERE id=$1 AND version=$7',
        [
          id,
          body!.stimulusId,
          body!.questionType,
          body!.difficulty,
          JSON.stringify(body!.content),
          new Date(),
          q.version,
        ],
      );
      if (!update.rowCount) fail(409, conflict);
      if (
        !isDeepStrictEqual(prior.answer, body!.answer) ||
        !isDeepStrictEqual(prior.explanation, body!.explanation)
      )
        await client.query(
          'UPDATE question_answer SET answer=$2::jsonb,explanation=$3::jsonb,updated_at=$4 WHERE question_id=$1',
          [
            id,
            JSON.stringify(body!.answer),
            JSON.stringify(body!.explanation),
            new Date(),
          ],
        );
      await relationships(id!, body!);
    } else {
      let status = q.status;
      let previous = q.previous_status;
      let current = q.current_version_id;
      let targetBank = q.question_bank_id;
      let owner = q.owner_id;
      if (action === 'publish') {
        if (status !== 'DRAFT')
          fail(409, 'Chỉ question DRAFT mới có thể publish');
        const target = (
          await client.query(
            'SELECT * FROM question_bank WHERE id=$1 AND deleted_at IS NULL',
            [q.question_bank_id],
          )
        ).rows[0];
        if (!target) throw new Error('Question bank unavailable');
        if (target.status !== 'ACTIVE')
          fail(409, 'Không thể publish question trong archived question bank');
        const attached = q.stimulus_id
          ? (
              await client.query('SELECT * FROM stimulus WHERE id=$1', [
                q.stimulus_id,
              ])
            ).rows[0]
          : null;
        if (attached && attached.status !== 'PUBLISHED')
          fail(409, 'Question chỉ có thể publish khi stimulus đã PUBLISHED');
        const draft = await this.response(client, id!);
        for (const type of ['topic', 'skill']) {
          const archived = await client.query(
            `SELECT 1 FROM ${type} WHERE id=ANY($1::uuid[]) AND status<>'ACTIVE'`,
            [draft[type + 'Ids']],
          );
          if (archived.rowCount)
            fail(409, 'Question không thể publish với Topic/Skill đã archive');
        }
        validateAggregate(
          q.question_type,
          draft.content,
          draft.answer,
          request,
        );
        if (!draft.explanation?.text?.trim())
          fail(400, 'Question phải có explanation trước khi publish');
        const rawAnswer = (
          await client.query(
            'SELECT answer,explanation FROM question_answer WHERE question_id=$1',
            [id],
          )
        ).rows[0];
        const snapshot: JsonRecord = {
          questionId: id,
          questionType: q.question_type,
          difficulty: q.difficulty,
          content: q.content,
          answer: rawAnswer.answer,
          explanation: rawAnswer.explanation,
          questionBankId: q.question_bank_id,
          topicIds: draft.topicIds,
          skillIds: draft.skillIds,
          tagIds: draft.tagIds,
        };
        if (attached)
          snapshot.stimulus = {
            id: attached.id,
            title: attached.title,
            content: attached.content,
            ...(attached.source !== null ? { source: attached.source } : {}),
          };
        const versionNumber = Number(
          (
            await client.query(
              'SELECT coalesce(max(version_number),0)+1 AS n FROM question_version WHERE question_id=$1',
              [id],
            )
          ).rows[0].n,
        );
        current = randomUUID();
        const now = new Date();
        await client.query(
          `INSERT INTO question_version(id,question_id,version_number,snapshot,change_summary,created_by,created_at,published_at,review_status)
              VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$7,'PENDING')`,
          [
            current,
            id,
            versionNumber,
            JSON.stringify(snapshot),
            body!.changeSummary?.trim() ? javaTrim(body!.changeSummary) : null,
            request.user.id,
            now,
          ],
        );
        status = 'PUBLISHED';
        previous = null;
      } else if (action === 'revise') {
        if (status !== 'PUBLISHED')
          fail(409, 'Chỉ question PUBLISHED mới có thể đưa về revise');
        status = 'DRAFT';
      } else if (action === 'archive') {
        if (status === 'ARCHIVED') fail(409, 'Question đã archive');
        previous = status;
        status = 'ARCHIVED';
      } else if (action === 'restore') {
        if (status !== 'ARCHIVED')
          fail(409, 'Chỉ question ARCHIVED mới có thể restore');
        status = previous ?? 'DRAFT';
        previous = null;
      } else if (action === 'transfer-ownership') {
        const target = await bank(body!.targetQuestionBankId);
        if (target.id === targetBank)
          fail(409, 'Question đã thuộc target question bank');
        targetBank = target.id;
        owner = target.scope === 'TEACHER' ? target.owner_id : null;
      }
      const update = await client.query(
        'UPDATE question SET status=$2,previous_status=$3,current_version_id=$4,question_bank_id=$5,owner_id=$6,version=version+1,updated_at=$7 WHERE id=$1 AND version=$8',
        [
          id,
          status,
          previous,
          current,
          targetBank,
          owner,
          new Date(),
          q.version,
        ],
      );
      if (!update.rowCount) fail(409, conflict);
      if (action === 'transfer-ownership')
        await client.query(
          `INSERT INTO question_ownership_audit(id,question_id,from_bank_id,to_bank_id,from_owner_id,to_owner_id,changed_by,reason,changed_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            randomUUID(),
            id,
            q.question_bank_id,
            targetBank,
            q.owner_id,
            owner,
            request.user.id,
            javaTrim(body!.reason),
            new Date(),
          ],
        );
    }
    return this.response(client, resultId);
  }
  async response(client: PoolClient, id: string): Promise<JsonRecord> {
    const row = (
      await client.query(
        `SELECT q.id,q.question_bank_id AS "questionBankId",q.stimulus_id AS "stimulusId",q.question_type AS "questionType",q.difficulty,q.status,
      q.content,a.answer,a.explanation,ARRAY(SELECT topic_id FROM question_topic WHERE question_id=q.id) AS "topicIds",
      ARRAY(SELECT skill_id FROM question_skill WHERE question_id=q.id) AS "skillIds",ARRAY(SELECT tag_id FROM question_tag WHERE question_id=q.id) AS "tagIds",
      q.owner_id AS "ownerAccountId",q.created_by AS "createdByAccountId",q.current_version_id AS "currentVersionId",${dates('q')}
      FROM question q JOIN question_answer a ON a.question_id=q.id WHERE q.id=$1`,
        [id],
      )
    ).rows[0];
    return {
      ...row,
      content: {
        title: row.content.title ?? null,
        prompt: row.content.prompt ?? null,
        options:
          row.content.options?.map((o: JsonRecord) => ({
            id: o.id,
            content: o.content,
          })) ?? null,
      },
      answer: {
        correctOptionIds: row.answer.correctOptionIds ?? null,
        acceptedAnswers: row.answer.acceptedAnswers ?? null,
        gradingMode: row.answer.gradingMode ?? null,
        gradingGuide: row.answer.gradingGuide ?? null,
      },
      explanation: { text: row.explanation.text ?? null },
    };
  }
}
