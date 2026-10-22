import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';
import { apiError } from '../read-api/auth.guard.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { academicUuid, requireAuthor } from '../read-api/academic.service.js';
import { javaTrim } from '../academic-write/question.binding.js';
import { parsePaging, parseSort } from '../read-api/paging.js';
import { assessmentBody } from './assessment.binding.js';
import type { Row } from './assessment.binding.js';
export const minTime = (a: any, b: any) =>
  a === null ? b : b === null ? a : new Date(a) < new Date(b) ? a : b;
const json = (value: any) =>
  value === null || value === undefined ? null : JSON.stringify(value);
const iso = (v: any) => (v === null ? null : new Date(v).toISOString());
@Injectable()
export class AssessmentAuthoringService {
  constructor(private readonly db: DatabaseService) {}
  fail(r: ReadRequest, status: number, message: string): never {
    throw apiError(status, message, r.path);
  }
  async require(c: PoolClient, id: string, r: ReadRequest) {
    const a = (
      await c.query(
        `SELECT *,created_at AT TIME ZONE 'UTC' AS created_at,updated_at AT TIME ZONE 'UTC' AS updated_at FROM assessments WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )
    ).rows[0];
    if (!a) this.fail(r, 404, `Không tìm thấy assessment với id: ${id}`);
    return a;
  }
  manage(a: Row, r: ReadRequest) {
    if (!r.user.roles.includes('ADMIN') && a.owner_id !== r.user.id)
      this.fail(r, 403, 'Bạn không có quyền quản lý đề thi này');
  }
  private schedule(b: Row, r: ReadRequest) {
    const before = (a: any, b: any) =>
      a !== null && b !== null && new Date(a) < new Date(b);
    if (before(b.availableUntil, b.availableFrom))
      this.fail(
        r,
        400,
        'Thời gian mở đề (availableFrom) không thể sau thời gian đóng đề (availableUntil)',
      );
    if (b.releasePolicy === 'AFTER_DEADLINE') {
      if (!b.resultsReleaseAt && !b.availableUntil)
        this.fail(
          r,
          400,
          'Khi chọn releasePolicy là AFTER_DEADLINE, bắt buộc phải có resultsReleaseAt hoặc availableUntil',
        );
      if (before(b.resultsReleaseAt, b.availableUntil))
        this.fail(
          r,
          400,
          'Thời điểm công bố kết quả (resultsReleaseAt) không thể trước hạn đóng đề (availableUntil)',
        );
      if (before(b.resultsReleaseAt, b.availableFrom))
        this.fail(
          r,
          400,
          'Thời điểm công bố kết quả (resultsReleaseAt) không thể trước thời gian mở đề (availableFrom)',
        );
    }
  }
  private timing(type: string, mode: string, r: ReadRequest) {
    if (type !== 'TEST' && mode === 'STRICT')
      this.fail(
        r,
        400,
        'Chỉ bài TEST (performance test) mới được tính giờ STRICT; DRILL và HOMEWORK không tính giờ',
      );
  }
  async questions(c: PoolClient, moduleId: string) {
    return (
      await c.query(
        `SELECT a.id,a.module_id AS "moduleId",a.question_id AS "questionId",a.question_version_id AS "questionVersionId",a.position,a.points::float8 AS points,
 v.snapshot->>'questionType' AS "questionType",v.snapshot->>'difficulty' AS difficulty,a.config FROM assessment_questions a JOIN question_version v ON v.id=a.question_version_id JOIN question live ON live.id=a.question_id AND live.deleted_at IS NULL WHERE a.module_id=$1 ORDER BY a.position`,
        [moduleId],
      )
    ).rows;
  }
  async module(c: PoolClient, id: string, created = false) {
    const m = (
      await c.query(
        `SELECT id,section_id AS "sectionId",name,code,order_index AS "orderIndex",duration_seconds AS "durationSeconds",config,created_at AT TIME ZONE 'UTC' AS "createdAt",updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM assessment_modules WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )
    ).rows[0];
    return {
      ...m,
      createdAt: created ? null : iso(m.createdAt),
      updatedAt: created ? null : iso(m.updatedAt),
      questions: await this.questions(c, id),
    };
  }
  async section(c: PoolClient, id: string, created = false) {
    const s = (
      await c.query(
        `SELECT id,assessment_id AS "assessmentId",name,code,order_index AS "orderIndex",duration_seconds AS "durationSeconds",config,created_at AT TIME ZONE 'UTC' AS "createdAt",updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM assessment_sections WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )
    ).rows[0];
    const modules = [];
    for (const m of (
      await c.query(
        'SELECT id FROM assessment_modules WHERE section_id=$1 AND deleted_at IS NULL ORDER BY order_index',
        [id],
      )
    ).rows)
      modules.push(await this.module(c, m.id));
    return {
      ...s,
      createdAt: created ? null : iso(s.createdAt),
      updatedAt: created ? null : iso(s.updatedAt),
      modules,
    };
  }
  async detail(c: PoolClient, id: string, created = false, oldUpdated?: any) {
    const a = (
      await c.query(
        `SELECT id,title,description,type,status,access_mode AS "accessMode",timing_mode AS "timingMode",release_policy AS "releasePolicy",results_release_at AS "resultsReleaseAt",results_released_at AS "resultsReleasedAt",available_from AS "availableFrom",available_until AS "availableUntil",max_attempts AS "maxAttempts",mode,exam_type AS "examType",config,owner_id AS "ownerId",created_at AT TIME ZONE 'UTC' AS "createdAt",updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM assessments WHERE id=$1`,
        [id],
      )
    ).rows[0];
    const sections = [];
    for (const s of (
      await c.query(
        'SELECT id FROM assessment_sections WHERE assessment_id=$1 AND deleted_at IS NULL ORDER BY order_index',
        [id],
      )
    ).rows)
      sections.push(await this.section(c, s.id));
    for (const key of [
      'resultsReleaseAt',
      'resultsReleasedAt',
      'availableFrom',
      'availableUntil',
      'createdAt',
      'updatedAt',
    ])
      a[key] = iso(a[key]);
    if (created) {
      a.createdAt = null;
      a.updatedAt = null;
    } else if (oldUpdated !== undefined) a.updatedAt = iso(oldUpdated);
    return { ...a, sections };
  }
  private assignment(row: Row) {
    return {
      id: row.id,
      assessmentId: row.assessment_id,
      studentId: row.student_id,
      assignedAt: iso(row.assigned_at),
      dueAt: iso(row.due_at),
    };
  }
  async read(action: string, r: ReadRequest, rawId?: string, q: Row = {}) {
    const id = rawId === undefined ? undefined : academicUuid(rawId, r);
    if (action === 'assignments') {
      if (!r.user.roles.includes('STUDENT'))
        this.fail(r, 403, 'Bạn không có quyền thực hiện thao tác này');
    } else requireAuthor(r);
    return this.db.readSnapshot(async (c) => {
      if (action === 'detail') {
        const a = await this.require(c, id!, r);
        this.manage(a, r);
        return this.detail(c, id!);
      }
      if (action === 'submissions') {
        const a = await this.require(c, id!, r);
        this.manage(a, r);
      }
      const paging = parsePaging(q);
      let where = '';
      let table = 'assessments',
        params: unknown[] = [];
      let sort = '';
      if (action === 'assignments') {
        table = 'assessment_assignments';
        where = 'student_id=$1';
        params = [r.user.id];
        sort = parseSort(
          q,
          { id: 'id', assignedAt: 'assigned_at', dueAt: 'due_at' },
          r.path,
          [],
        );
      } else if (action === 'submissions') {
        table = 'attempt';
        where = 'assessment_id=$1';
        params = [id];
        sort = 'ORDER BY started_at DESC';
      } else {
        where = 'deleted_at IS NULL';
        if (!r.user.roles.includes('ADMIN')) {
          where += ' AND owner_id=$1';
          params = [r.user.id];
        }
        sort = parseSort(
          q,
          {
            id: 'id',
            title: 'title',
            description: 'description',
            type: 'type',
            status: 'status',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            availableFrom: 'available_from',
            availableUntil: 'available_until',
            maxAttempts: 'max_attempts',
            accessMode: 'access_mode',
            timingMode: 'timing_mode',
            releasePolicy: 'release_policy',
            resultsReleaseAt: 'results_release_at',
            resultsReleasedAt: 'results_released_at',
            mode: 'mode',
            examType: 'exam_type',
            durationSeconds: 'duration_seconds',
          },
          r.path,
          ['title', 'description', 'mode', 'examType'],
        );
      }
      const total = Number(
        (
          await c.query(
            `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
            params,
          )
        ).rows[0].n,
      );
      params.push(paging.size, paging.page * paging.size);
      const rows = (
        await c.query(
          `SELECT * FROM ${table} WHERE ${where} ${sort} LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        )
      ).rows;
      const content = [];
      for (const row of rows) {
        if (action === 'assignments') content.push(this.assignment(row));
        else if (action === 'submissions') {
          const u = (
            await c.query(
              'SELECT name,email FROM users WHERE id=$1 AND deleted_at IS NULL',
              [row.student_id],
            )
          ).rows[0];
          if (!u) throw new Error('Missing student');
          const result = (
            await c.query('SELECT * FROM results WHERE attempt_id=$1', [row.id])
          ).rows[0];
          content.push({
            attemptId: row.id,
            studentId: row.student_id,
            studentName: u.name,
            studentEmail: u.email,
            attemptNumber: row.attempt_number,
            status: row.status,
            submissionReason: row.submission_reason,
            startedAt: iso(row.started_at),
            submittedAt: iso(row.submitted_at),
            totalGrade: result ? Number(result.total_grade) : null,
            maxGrade: result ? Number(result.max_grade) : null,
            totalTimeSeconds: result?.total_time ?? 0,
          });
        } else {
          const a = await this.detail(c, row.id);
          const {
            mode: _mode,
            examType: _examType,
            config: _config,
            sections,
            ...rest
          } = a;
          content.push({ ...rest, totalSections: sections.length });
        }
      }
      return {
        content,
        page: {
          size: paging.size,
          number: paging.page,
          totalElements: total,
          totalPages: Math.ceil(total / paging.size),
        },
      };
    });
  }
  async extendDeadline(c: PoolClient, attempt: Row, deadline: any) {
    if (
      attempt.status !== 'STARTED' ||
      attempt.expires_at === null ||
      (deadline !== null && new Date(deadline) <= new Date(attempt.expires_at))
    )
      return;
    await c.query(
      'UPDATE attempt SET expires_at=$2,updated_at=$3 WHERE id=$1',
      [attempt.id, deadline, new Date()],
    );
    const assessment = (
      await c.query('SELECT timing_mode FROM assessments WHERE id=$1', [
        attempt.assessment_id,
      ])
    ).rows[0];
    if (assessment.timing_mode !== 'STRICT') return;
    const active = (
      await c.query(
        "SELECT t.*,s.duration_seconds FROM attempt_section t JOIN assessment_sections s ON s.id=t.section_id WHERE t.attempt_id=$1 AND t.status='IN_PROGRESS'",
        [attempt.id],
      )
    ).rows[0];
    if (!active) return;
    const modules = (
      await c.query(
        'SELECT t.*,m.duration_seconds FROM attempt_module t JOIN assessment_modules m ON m.id=t.module_id WHERE t.attempt_id=$1 AND m.section_id=$2',
        [attempt.id, active.section_id],
      )
    ).rows;
    const moduleTimed =
      modules.length > 0 && modules.every((m) => m.duration_seconds !== null);
    const plus = (start: any, sec: any) =>
      sec === null ? null : new Date(new Date(start).getTime() + sec * 1000);
    await c.query(
      'UPDATE attempt_section SET expires_at=$2,updated_at=$3 WHERE id=$1',
      [
        active.id,
        minTime(
          moduleTimed ? null : plus(active.started_at, active.duration_seconds),
          deadline,
        ),
        new Date(),
      ],
    );
    if (moduleTimed)
      for (const m of modules.filter((m) => m.status === 'IN_PROGRESS'))
        await c.query(
          'UPDATE attempt_module SET expires_at=$2,updated_at=$3 WHERE id=$1',
          [
            m.id,
            minTime(plus(m.started_at, m.duration_seconds), deadline),
            new Date(),
          ],
        );
  }
  async write(action: string, r: ReadRequest, rawId?: string, input?: unknown) {
    const id = rawId === undefined ? undefined : academicUuid(rawId, r);
    const b = [
      'create',
      'update',
      'section',
      'module',
      'question',
      'assign',
      'access-mode',
    ].includes(action)
      ? assessmentBody(action, input, r)
      : null;
    requireAuthor(r);
    try {
      return await this.db.writeTransaction(async (c) => {
        let a: Row | undefined, part: Row | undefined;
        if (action !== 'create') {
          if (action === 'module' || action === 'question') {
            const table =
              action === 'module'
                ? 'assessment_sections'
                : 'assessment_modules';
            part = (
              await c.query(
                `SELECT * FROM ${table} WHERE id=$1 AND deleted_at IS NULL`,
                [id],
              )
            ).rows[0];
            if (!part)
              this.fail(
                r,
                404,
                `Không tìm thấy ${action === 'module' ? 'section' : 'module'} với id: ${id}`,
              );
            a = await this.require(c, part.assessment_id, r);
          } else a = await this.require(c, id!, r);
          this.manage(a!, r);
        }
        const now = new Date(),
          generated = randomUUID();
        if (action === 'create' || action === 'update') {
          if (a && a.status !== 'DRAFT') {
            const old = {
              type: a.type,
              releasePolicy: a.release_policy,
              resultsReleaseAt: iso(a.results_release_at),
              availableFrom: iso(a.available_from),
              mode: a.mode,
              examType: a.exam_type,
            };
            if (
              Object.entries(old).some(
                ([k, v]) => !isDeepStrictEqual(v, b![k]),
              ) ||
              (b!.maxAttempts !== null && b!.maxAttempts !== a.max_attempts) ||
              (b!.timingMode !== null && b!.timingMode !== a.timing_mode) ||
              (b!.config !== null && !isDeepStrictEqual(b!.config, a.config))
            )
              this.fail(
                r,
                409,
                'Đề đã publish chỉ có thể sửa title, description, accessMode và gia hạn availableUntil',
              );
            if (
              b!.availableUntil !== null &&
              (a.available_until === null ||
                new Date(b!.availableUntil) < new Date(a.available_until))
            )
              this.fail(
                r,
                400,
                'Không thể rút ngắn thời gian đóng đề (availableUntil) của đề đã publish, chỉ có thể gia hạn',
              );
          }
          this.schedule(b!, r);
          this.timing(b!.type, b!.timingMode ?? a?.timing_mode ?? 'SOFT', r);
          const values = [
            javaTrim(b!.title),
            b!.description,
            b!.type,
            b!.releasePolicy,
            b!.resultsReleaseAt,
            b!.availableFrom,
            b!.availableUntil,
            b!.maxAttempts ?? a?.max_attempts ?? 1,
            b!.mode,
            b!.examType,
            json(b!.config ?? (a && a.status !== 'DRAFT' ? a.config : null)),
            b!.accessMode ?? a?.access_mode ?? 'ASSIGNED_ONLY',
            b!.timingMode ?? a?.timing_mode ?? 'SOFT',
          ];
          if (!a) {
            await c.query(
              `INSERT INTO assessments(id,title,description,type,release_policy,results_release_at,available_from,available_until,max_attempts,mode,exam_type,config,access_mode,timing_mode,owner_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$16)`,
              [generated, ...values, r.user.id, now],
            );
            return this.detail(c, generated, true);
          }
          const previous = [
            a.title,
            a.description,
            a.type,
            a.release_policy,
            iso(a.results_release_at),
            iso(a.available_from),
            iso(a.available_until),
            a.max_attempts,
            a.mode,
            a.exam_type,
            json(a.config),
            a.access_mode,
            a.timing_mode,
          ];
          const unchanged = values.every((v, i) =>
            i === 10
              ? isDeepStrictEqual(
                  v === null ? null : JSON.parse(String(v)),
                  previous[i] === null ? null : JSON.parse(String(previous[i])),
                )
              : isDeepStrictEqual(v, previous[i]),
          );
          if (unchanged) return this.detail(c, id!, false, a.updated_at);
          await c.query(
            `UPDATE assessments SET title=$2,description=$3,type=$4,release_policy=$5,results_release_at=$6,available_from=$7,available_until=$8,max_attempts=$9,mode=$10,exam_type=$11,config=$12::jsonb,access_mode=$13,timing_mode=$14,updated_at=$15 WHERE id=$1`,
            [id, ...values, now],
          );
          if (
            a.status !== 'DRAFT' &&
            iso(a.available_until) !== b!.availableUntil
          )
            for (const attempt of (
              await c.query(
                "SELECT * FROM attempt WHERE assessment_id=$1 AND status='STARTED' FOR UPDATE",
                [id],
              )
            ).rows) {
              const assignment = (
                await c.query(
                  'SELECT due_at FROM assessment_assignments WHERE assessment_id=$1 AND student_id=$2',
                  [id, attempt.student_id],
                )
              ).rows[0];
              await this.extendDeadline(
                c,
                attempt,
                minTime(assignment?.due_at ?? null, b!.availableUntil),
              );
            }
          return this.detail(c, id!, false, a.updated_at);
        }
        if (
          ['section', 'module', 'question', 'publish'].includes(action) &&
          a!.status !== 'DRAFT'
        )
          this.fail(
            r,
            409,
            action === 'publish'
              ? 'Chỉ có thể publish đề thi DRAFT'
              : `Chỉ có thể thêm ${action === 'section' ? 'Section' : action === 'module' ? 'Module' : 'câu hỏi'} khi đề ở trạng thái DRAFT`,
          );
        if (action === 'section' || action === 'module') {
          if (action === 'section')
            await c.query(
              'INSERT INTO assessment_sections(id,assessment_id,name,code,order_index,duration_seconds,config,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8)',
              [
                generated,
                a!.id,
                javaTrim(b!.name),
                b!.code,
                b!.orderIndex,
                b!.durationSeconds,
                json(b!.config),
                now,
              ],
            );
          else
            await c.query(
              'INSERT INTO assessment_modules(id,assessment_id,section_id,name,code,order_index,duration_seconds,config,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9)',
              [
                generated,
                a!.id,
                id,
                javaTrim(b!.name),
                b!.code,
                b!.orderIndex,
                b!.durationSeconds,
                json(b!.config),
                now,
              ],
            );
          return action === 'section'
            ? this.section(c, generated, true)
            : this.module(c, generated, true);
        }
        if (action === 'question') {
          const q = (
            await c.query(
              'SELECT * FROM question WHERE id=$1 AND deleted_at IS NULL',
              [b!.questionId],
            )
          ).rows[0];
          if (!q)
            this.fail(
              r,
              404,
              `Không tìm thấy question với id: ${b!.questionId}`,
            );
          const v = (
            await c.query('SELECT * FROM question_version WHERE id=$1', [
              b!.questionVersionId,
            ])
          ).rows[0];
          if (!v)
            this.fail(
              r,
              404,
              `Không tìm thấy questionVersion với id: ${b!.questionVersionId}`,
            );
          if (v.question_id !== q.id)
            this.fail(
              r,
              400,
              'QuestionVersion không thuộc Question được chỉ định',
            );
          const bank = (
            await c.query(
              'SELECT * FROM question_bank WHERE id=$1 AND deleted_at IS NULL',
              [q.question_bank_id],
            )
          ).rows[0];
          if (!bank) throw new Error('Missing bank');
          if (bank.scope === 'SYSTEM' && v.review_status !== 'APPROVED')
            this.fail(
              r,
              400,
              'QuestionVersion thuộc System Bank phải được APPROVED trước khi đưa vào Assessment',
            );
          if (
            bank.scope === 'TEACHER' &&
            !r.user.roles.includes('ADMIN') &&
            bank.owner_id !== r.user.id
          )
            this.fail(
              r,
              403,
              'Bạn không có quyền sử dụng câu hỏi từ Ngân hàng câu hỏi của giáo viên khác',
            );
          await c.query(
            'INSERT INTO assessment_questions(id,assessment_id,section_id,module_id,question_id,question_version_id,position,points,config) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
            [
              generated,
              a!.id,
              part!.section_id,
              id,
              q.id,
              v.id,
              b!.position,
              b!.points ?? 1,
              json(b!.config),
            ],
          );
          return {
            ...(await this.questions(c, id!)).find((x) => x.id === generated),
            points: Number(b!.points ?? 1),
          };
        }
        if (action === 'clone') {
          await c.query(
            `INSERT INTO assessments SELECT (jsonb_populate_record(NULL::assessments,to_jsonb(a)||jsonb_build_object('id',$2::text,'title','Copy of '||a.title,'status','DRAFT','owner_id',$3::text,'created_at',$4::timestamptz,'updated_at',$4::timestamptz,'results_released_at',NULL,'duration_seconds',NULL))).* FROM assessments a WHERE id=$1`,
            [id, generated, r.user.id, now],
          );
          for (const sec of (
            await c.query(
              'SELECT * FROM assessment_sections WHERE assessment_id=$1 AND deleted_at IS NULL ORDER BY order_index',
              [id],
            )
          ).rows) {
            const sid = randomUUID();
            await c.query(
              "INSERT INTO assessment_sections SELECT (jsonb_populate_record(NULL::assessment_sections,to_jsonb(s)||jsonb_build_object('id',$2::text,'assessment_id',$3::text,'created_at',$4::timestamptz,'updated_at',$4::timestamptz))).* FROM assessment_sections s WHERE id=$1",
              [sec.id, sid, generated, now],
            );
            for (const mod of (
              await c.query(
                'SELECT * FROM assessment_modules WHERE section_id=$1 AND deleted_at IS NULL ORDER BY order_index',
                [sec.id],
              )
            ).rows) {
              const mid = randomUUID();
              await c.query(
                "INSERT INTO assessment_modules SELECT (jsonb_populate_record(NULL::assessment_modules,to_jsonb(m)||jsonb_build_object('id',$2::text,'assessment_id',$3::text,'section_id',$4::text,'created_at',$5::timestamptz,'updated_at',$5::timestamptz))).* FROM assessment_modules m WHERE id=$1",
                [mod.id, mid, generated, sid, now],
              );
              await c.query(
                "INSERT INTO assessment_questions SELECT (jsonb_populate_record(NULL::assessment_questions,to_jsonb(q)||jsonb_build_object('id',gen_random_uuid(),'assessment_id',$2::text,'section_id',$3::text,'module_id',$4::text))).* FROM assessment_questions q WHERE module_id=$1",
                [mod.id, generated, sid, mid],
              );
            }
          }
          return {
            sourceAssessmentId: id,
            newAssessmentId: generated,
            title: 'Copy of ' + a!.title,
            message: 'Đã nhân bản đề thi thành công sang bản nháp mới.',
          };
        }
        if (action === 'assign') {
          const student = (
            await c.query(
              'SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL',
              [b!.studentId],
            )
          ).rows[0];
          if (!student)
            this.fail(r, 404, `Không tìm thấy user với id: ${b!.studentId}`);
          const release = a!.results_release_at ?? a!.available_until;
          if (
            a!.release_policy === 'AFTER_DEADLINE' &&
            release &&
            b!.dueAt &&
            new Date(b!.dueAt) > new Date(release)
          )
            this.fail(
              r,
              400,
              'Hạn nộp bài của học sinh (dueAt) không thể muộn hơn thời điểm công bố kết quả (resultsReleaseAt)',
            );
          const previous = (
            await c.query(
              'SELECT * FROM assessment_assignments WHERE assessment_id=$1 AND student_id=$2',
              [id, b!.studentId],
            )
          ).rows[0];
          const active = (
            await c.query(
              "SELECT * FROM attempt WHERE assessment_id=$1 AND student_id=$2 AND status='STARTED' FOR UPDATE",
              [id, b!.studentId],
            )
          ).rows[0];
          const shortening = (candidate: any, current: any) =>
            candidate !== null &&
            (current === null || new Date(candidate) < new Date(current));
          if (a!.status !== 'DRAFT') {
            if (previous && shortening(b!.dueAt, previous.due_at))
              this.fail(
                r,
                400,
                'Không thể rút ngắn hạn nộp (dueAt) của học sinh khi đề đã publish, chỉ có thể gia hạn',
              );
            if (!previous && active && shortening(b!.dueAt, active.expires_at))
              this.fail(
                r,
                400,
                'Học sinh đang làm bài: hạn nộp (dueAt) không thể sớm hơn hạn hiện tại của lượt làm bài',
              );
          }
          const result = (
            await c.query(
              'INSERT INTO assessment_assignments(id,assessment_id,student_id,assigned_at,due_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(assessment_id,student_id) DO UPDATE SET assigned_at=EXCLUDED.assigned_at,due_at=EXCLUDED.due_at RETURNING *',
              [generated, id, b!.studentId, now, b!.dueAt],
            )
          ).rows[0];
          if (active)
            await this.extendDeadline(
              c,
              active,
              minTime(b!.dueAt, a!.available_until),
            );
          return this.assignment(result);
        }
        if (action === 'publish') {
          const sections = (
            await c.query(
              'SELECT * FROM assessment_sections WHERE assessment_id=$1 AND deleted_at IS NULL ORDER BY order_index',
              [id],
            )
          ).rows;
          if (!sections.length)
            this.fail(
              r,
              400,
              'Đề thi phải có ít nhất một Section trước khi publish',
            );
          let count = 0,
            duration = 0;
          const unsupported = [];
          for (const sec of sections) {
            const modules = (
              await c.query(
                'SELECT * FROM assessment_modules WHERE section_id=$1 AND deleted_at IS NULL ORDER BY order_index',
                [sec.id],
              )
            ).rows;
            if (!modules.length)
              this.fail(
                r,
                400,
                `Section ${sec.name} phải có ít nhất một Module`,
              );
            const timed = modules.filter(
              (m) => m.duration_seconds !== null,
            ).length;
            if (timed && timed < modules.length)
              this.fail(
                r,
                400,
                `Section ${sec.name}: thời lượng (durationSeconds) phải đặt cho mọi Module hoặc không Module nào`,
              );
            duration += timed
              ? modules.reduce((n, m) => n + m.duration_seconds, 0)
              : (sec.duration_seconds ?? 0);
            for (const m of modules)
              for (const q of await this.questions(c, m.id)) {
                count++;
                if (['SHORT_ANSWER', 'ESSAY'].includes(q.questionType))
                  unsupported.push(q.questionId);
              }
          }
          if (!count)
            this.fail(
              r,
              400,
              'Đề thi phải có ít nhất một câu hỏi trước khi publish',
            );
          if (unsupported.length)
            this.fail(
              r,
              422,
              'Đề chứa loại câu hỏi chưa được hỗ trợ chấm tự động trong phiên bản này: [' +
                unsupported.join(', ') +
                ']',
            );
          await c.query(
            "UPDATE assessments SET status='PUBLISHED',duration_seconds=$2,updated_at=$3 WHERE id=$1",
            [id, duration || null, now],
          );
        } else if (action === 'close') {
          if (a!.status !== 'PUBLISHED')
            this.fail(r, 409, 'Chỉ có thể đóng đề thi đang PUBLISHED');
          await c.query(
            "UPDATE assessments SET status='CLOSED',updated_at=$2 WHERE id=$1",
            [id, now],
          );
        } else if (action === 'access-mode') {
          if (a!.access_mode !== b!.accessMode)
            await c.query(
              'UPDATE assessments SET access_mode=$2,updated_at=$3 WHERE id=$1',
              [id, b!.accessMode, now],
            );
        } else if (action === 'release-results') {
          if (a!.release_policy !== 'MANUAL')
            this.fail(
              r,
              400,
              'API release-results chỉ áp dụng cho đề có releasePolicy là MANUAL',
            );
          await c.query(
            'UPDATE assessments SET results_released_at=$2,updated_at=$3 WHERE id=$1',
            [id, now, now],
          );
        }
        return this.detail(c, id!, false, a!.updated_at);
      }, 'assessment');
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith('23'))
        this.fail(r, 409, 'Dữ liệu bị trùng hoặc đang được sử dụng');
      throw error;
    }
  }
}
