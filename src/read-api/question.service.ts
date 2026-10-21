import { HttpException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import type { ReadRequest } from './auth.guard.js';
import { apiError } from './auth.guard.js';
import { AcademicReadService, academicUuid, dates, requireAuthor } from './academic.service.js';
import { parsePaging, parseSort } from './paging.js';

const metadata = `q.id, q.question_bank_id AS "questionBankId", q.stimulus_id AS "stimulusId",
  q.question_type AS "questionType", q.difficulty,
  ARRAY(SELECT topic_id FROM question_topic WHERE question_id = q.id) AS "topicIds",
  ARRAY(SELECT skill_id FROM question_skill WHERE question_id = q.id) AS "skillIds",
  ARRAY(SELECT tag_id FROM question_tag WHERE question_id = q.id) AS "tagIds"`;
const authors = `q.status, q.owner_id AS "ownerAccountId", q.created_by AS "createdByAccountId",
  q.current_version_id AS "currentVersionId", ${dates('q')}`;

@Injectable()
export class QuestionReadService {
  constructor(private readonly database: DatabaseService, private readonly academic: AcademicReadService) {}

  async list(request: ReadRequest, query: Record<string, unknown>, publicCatalog: boolean) {
    const values: unknown[] = [];
    const predicates = ['q.deleted_at IS NULL'];
    const bindingErrors: Record<string, string> = {};
    const collect = (error: HttpException) => Object.assign(bindingErrors, (error.getResponse() as { fieldErrors: Record<string, string> }).fieldErrors);
    const add = (sql: string, value: unknown) => { values.push(value); predicates.push(sql.replace('?', `$${values.length}`)); };
    for (const key of ['questionBankId', 'topicId', 'skillId', 'tagId']) {
      if (!query[key]) continue;
      const raw = String(query[key]);
      let id: string;
      try { id = academicUuid(raw, request, key); }
      catch { collect(this.bindingError(request, key, raw, 'java.util.UUID', `Invalid UUID string: ${raw}`)); continue; }
      if (key === 'questionBankId') add('q.question_bank_id = ?', id);
      else {
        const relation = { topicId: ['question_topic', 'topic_id'], skillId: ['question_skill', 'skill_id'], tagId: ['question_tag', 'tag_id'] }[key]!;
        add(`EXISTS (SELECT 1 FROM ${relation[0]} WHERE question_id = q.id AND ${relation[1]} = ?)`, id);
      }
    }
    for (const [key, allowed] of Object.entries({ difficulty: ['EASY', 'MEDIUM', 'HARD'], status: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })) {
      if (!query[key]) continue;
      const raw = String(query[key]).trim();
      if (!allowed.includes(raw)) {
        collect(this.bindingError(request, key, String(query[key]), `com.example.demo.academiccontent.entity.Question${key === 'status' ? 'Status' : 'Difficulty'}`,
          `Failed to convert from type [java.lang.String] to type [com.example.demo.academiccontent.entity.Question${key === 'status' ? 'Status' : 'Difficulty'}] for value [${String(query[key])}]`));
        continue;
      }
      if (!(publicCatalog && key === 'status')) add(`q.${key} = ?`, raw);
    }
    const dateValues: Record<string, string> = {};
    for (const key of ['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo']) {
      if (!query[key]) continue;
      const raw = String(query[key]);
      const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,9}))?)?$/.exec(raw);
      const calendar = new Date(raw.substring(0, 10) + 'T00:00:00Z');
      if (!match || calendar.getUTCDate() !== Number(match[3]) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59) {
        collect(this.bindingError(request, key, raw, 'java.time.LocalDateTime', `Failed to convert from type [java.lang.String] to type [java.time.LocalDateTime] for value [${raw}]`));
        continue;
      }
      dateValues[key] = `${raw.substring(0, 16)}:${match[6] ?? '00'}.${(match[7] ?? '').padEnd(9, '0')}`;
      add(`q.${key.startsWith('created') ? 'created_at' : 'updated_at'} ${key.endsWith('From') ? '>=' : '<='} ?::timestamp`, raw);
    }
    if (Object.keys(bindingErrors).length) throw new HttpException({
      ...(apiError(400, 'Dữ liệu đầu vào không hợp lệ', request.path).getResponse() as object), fieldErrors: bindingErrors,
    }, 400);
    if (!publicCatalog) requireAuthor(request);
    const { page, size } = parsePaging(query);
    let order: string;
    try {
      order = parseSort(query, { createdAt: 'q.created_at', updatedAt: 'q.updated_at', difficulty: 'q.difficulty', status: 'q.status', questionType: 'q.question_type' }, request.path, []);
    } catch (error) {
      if (error instanceof HttpException) {
        const message = (error.getResponse() as {message: string}).message;
        throw apiError(400, 'Sort field không được hỗ trợ: ' + message.slice(message.indexOf("'") + 1, -1), request.path);
      }
      throw error;
    }
    for (const prefix of ['created', 'updated']) {
      const from = dateValues[prefix + 'From'];
      const to = dateValues[prefix + 'To'];
      if (from && to && from > to) throw apiError(400, `${prefix}From không được sau ${prefix}To`, request.path);
    }
    if (publicCatalog) predicates.push("q.status = 'PUBLISHED'", "b.scope = 'SYSTEM'", 'b.deleted_at IS NULL');
    else if (!request.user.roles.includes('ADMIN')) add('q.owner_id = ?', request.user.id);
    if (typeof query.keyword === 'string' && query.keyword.trim()) {
      const pattern = '%' + query.keyword.trim().toLowerCase().replace(/[\\%_]/g, value => '\\' + value) + '%';
      values.push(pattern);
      const title = `lower(q.content->>'title') LIKE $${values.length} ESCAPE E'\\\\'`;
      predicates.push(publicCatalog ? title : `(${title} OR lower(q.content->>'prompt') LIKE $${values.length} ESCAPE E'\\\\')`);
    }
    const fields = publicCatalog
      ? `${metadata}, q.current_version_id AS "questionVersionId", q.content->>'title' AS title`
      : `${metadata}, q.content->>'title' AS title, ${authors}`;
    return this.database.readSnapshot(client => this.academic.page(client,
      publicCatalog ? 'question q JOIN question_bank b ON b.id = q.question_bank_id' : 'question q',
      fields, predicates.join(' AND '), values, order, page, size));
  }

  async detail(request: ReadRequest, rawId: string, versions: boolean) {
    const id = academicUuid(rawId, request);
    requireAuthor(request);
    return this.database.readSnapshot(async client => {
      const row = (await client.query(`SELECT ${metadata}, ${authors}, q.content, a.answer, a.explanation
        FROM question q LEFT JOIN question_answer a ON a.question_id = q.id WHERE q.id = $1 AND q.deleted_at IS NULL`, [id])).rows[0];
      if (!row) throw apiError(404, `Không tìm thấy question với id: ${id}`, request.path);
      if (!request.user.roles.includes('ADMIN') && row.ownerAccountId !== request.user.id) {
        throw apiError(403, 'Bạn không có quyền truy cập question này', request.path);
      }
      if (versions) return (await client.query(`SELECT v.id, v.question_id AS "questionId", v.version_number AS "versionNumber", v.snapshot,
        v.change_summary AS "changeSummary", v.created_by AS "createdByAccountId",
        replace(v.published_at::text, ' ', 'T') AS "publishedAt", v.review_status AS "reviewStatus"
        FROM question_version v WHERE v.question_id = $1 ORDER BY v.version_number DESC`, [id])).rows;
      const content = row.content;
      const answer = row.answer;
      return { ...row,
        content: content ? { title: content.title ?? null, prompt: content.prompt ?? null,
          options: content.options?.map((o: {id: string; content: string}) => ({id: o.id, content: o.content})) ?? null } : null,
        answer: answer ? { correctOptionIds: answer.correctOptionIds ?? null, acceptedAnswers: answer.acceptedAnswers ?? null,
          gradingMode: answer.gradingMode ?? null, gradingGuide: answer.gradingGuide ?? null } : null,
        explanation: row.explanation ? { text: row.explanation.text ?? null } : null };
    });
  }

  private bindingError(request: ReadRequest, key: string, raw: string, type: string, detail: string) {
    const error = apiError(400, 'Dữ liệu đầu vào không hợp lệ', request.path);
    return new HttpException({ ...(error.getResponse() as object), fieldErrors: {
      [key]: `Failed to convert value of type 'java.lang.String' to required type '${type}'; ${detail}`,
    } }, 400);
  }
}
