import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { academicUuid } from '../read-api/academic.service.js';
import { AssessmentAuthoringService, minTime } from './authoring.service.js';
import { takingBody } from './taking.binding.js';
import type { Row } from './assessment.binding.js';
import { evaluate, jsonText } from './grading.js';
const iso = (v: any) =>
  v === null || v === undefined ? null : new Date(v).toISOString();
const millis = (v: any) => new Date(v).getTime();
const closed = (v: string) => v === 'COMPLETED' || v === 'EXPIRED';
const reached = (deadline: any, now: Date) =>
  deadline !== null && millis(deadline) <= now.getTime();
const plus = (start: any, seconds: any) =>
  start === null || seconds === null
    ? null
    : new Date(millis(start) + seconds * 1000);
const elapsed = (start: any, cap: any, end: any) =>
  start === null
    ? 0
    : Math.max(
        0,
        Math.floor((millis(minTime(cap, end)) - millis(start)) / 1000),
      );
const moduleTimed = (modules: Row[]) =>
  modules.length > 0 && modules.every((m) => m.duration_seconds !== null);
@Injectable()
export class AssessmentTakingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly author: AssessmentAuthoringService,
  ) {}
  private fail(r: ReadRequest, status: number, message: string): never {
    return this.author.fail(r, status, message);
  }
  private student(r: ReadRequest) {
    if (!r.user.roles.includes('STUDENT'))
      this.fail(r, 403, 'Bạn không có quyền thực hiện thao tác này');
  }
  async attempt(c: PoolClient, id: string, r: ReadRequest, lock = false) {
    const row = (
      await c.query(
        'SELECT * FROM attempt WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
        [id],
      )
    ).rows[0];
    if (!row) this.fail(r, 404, `Không tìm thấy attempt với id: ${id}`);
    row.assessment = await this.author.require(c, row.assessment_id, r);
    return row;
  }
  private own(a: Row, r: ReadRequest) {
    if (a.student_id !== r.user.id)
      this.fail(r, 403, 'Bạn không có quyền truy cập lượt làm bài này');
  }
  private strict(a: Row, r: ReadRequest) {
    if (a.assessment.timing_mode !== 'STRICT')
      this.fail(
        r,
        409,
        'Bài thi này mở toàn bộ cùng lúc, không có bước Section/Module: hãy nộp bài (submit) khi xong',
      );
  }
  private started(a: Row, r: ReadRequest) {
    if (a.status !== 'STARTED')
      this.fail(r, 409, `Lượt làm bài đã kết thúc (${a.status})`);
  }
  async sections(c: PoolClient, a: Row) {
    return (
      await c.query(
        'SELECT t.*,s.name,s.code,s.order_index,s.duration_seconds FROM attempt_section t JOIN assessment_sections s ON s.id=t.section_id AND s.deleted_at IS NULL WHERE t.attempt_id=$1 ORDER BY s.order_index',
        [a.id],
      )
    ).rows;
  }
  async modules(c: PoolClient, a: Row, sectionId: string) {
    return (
      await c.query(
        'SELECT t.*,m.name,m.code,m.order_index,m.duration_seconds,m.section_id FROM attempt_module t JOIN assessment_modules m ON m.id=t.module_id AND m.deleted_at IS NULL WHERE t.attempt_id=$1 AND m.section_id=$2 ORDER BY m.order_index',
        [a.id, sectionId],
      )
    ).rows;
  }
  async takingQuestions(c: PoolClient, moduleId: string) {
    return (
      await c.query(
        'SELECT q.*,v.snapshot FROM assessment_questions q JOIN question_version v ON v.id=q.question_version_id JOIN question live ON live.id=q.question_id AND live.deleted_at IS NULL WHERE q.module_id=$1 ORDER BY q.position',
        [moduleId],
      )
    ).rows.map((q) => this.takingQuestion(q));
  }
  private takingQuestion(q: Row) {
    const s = q.snapshot,
      content = s.content ?? null;
    return {
      assessmentQuestionId: q.id,
      moduleId: q.module_id,
      questionId: s.questionId,
      questionType: s.questionType,
      difficulty: s.difficulty,
      position: q.position,
      points: Number(q.points),
      prompt:
        content?.prompt !== null && content?.prompt !== undefined
          ? jsonText(content.prompt)
          : content?.text !== null && content?.text !== undefined
            ? jsonText(content.text)
            : null,
      content,
      options: Array.isArray(content?.options)
        ? content.options.map((o: Row) => ({
            id: o.id === null || o.id === undefined ? '' : jsonText(o.id),
            content: o.content ?? o,
          }))
        : [],
      stimulus: s.stimulus ?? null,
    };
  }
  async sheet(c: PoolClient, a: Row) {
    const sections = [];
    for (const sec of (
      await c.query(
        'SELECT * FROM assessment_sections WHERE assessment_id=$1 AND deleted_at IS NULL ORDER BY order_index',
        [a.assessment_id],
      )
    ).rows) {
      const rows = (
        await c.query(
          'SELECT * FROM assessment_modules WHERE section_id=$1 AND deleted_at IS NULL ORDER BY order_index',
          [sec.id],
        )
      ).rows;
      const modules = [];
      for (const m of rows)
        modules.push({
          moduleId: m.id,
          name: m.name,
          code: m.code,
          orderIndex: m.order_index,
          durationSeconds: m.duration_seconds,
          questions: await this.takingQuestions(c, m.id),
        });
      sections.push({
        sectionId: sec.id,
        name: sec.name,
        code: sec.code,
        orderIndex: sec.order_index,
        durationSeconds: moduleTimed(rows)
          ? rows.reduce((n, m) => n + m.duration_seconds, 0)
          : sec.duration_seconds,
        modules,
      });
    }
    return { sections };
  }
  async sectionDTO(c: PoolClient, a: Row, sec: Row) {
    const rows = await this.modules(c, a, sec.section_id);
    const timed = moduleTimed(rows);
    const active = timed
      ? rows.find((m) => m.status === 'IN_PROGRESS')
      : undefined;
    const modules = rows.map((m) => ({
      id: m.module_id,
      name: m.name,
      code: m.code,
      orderIndex: m.order_index,
      durationSeconds: m.duration_seconds,
      status: m.status,
      startedAt: iso(m.started_at),
      expiresAt: iso(m.expires_at),
    }));
    const questions = [];
    for (const m of rows) {
      if (timed && m.module_id !== active?.module_id) continue;
      questions.push(...(await this.takingQuestions(c, m.module_id)));
    }
    return {
      sectionId: sec.section_id,
      name: sec.name,
      code: sec.code,
      orderIndex: sec.order_index,
      durationSeconds: timed
        ? rows.reduce((n, m) => n + m.duration_seconds, 0)
        : sec.duration_seconds,
      status: sec.status,
      startedAt: iso(sec.started_at),
      expiresAt: iso(sec.expires_at),
      modules,
      activeModuleId: active?.module_id ?? null,
      questions,
    };
  }
  async startDTO(c: PoolClient, a: Row) {
    const strict = a.assessment.timing_mode === 'STRICT',
      sections = await this.sections(c, a),
      active = strict
        ? sections.find((s) => s.status === 'IN_PROGRESS')
        : undefined;
    return {
      attemptId: a.id,
      assessmentId: a.assessment_id,
      assessmentTitle: a.assessment.title,
      attemptNumber: a.attempt_number,
      status: a.status,
      timingMode: a.assessment.timing_mode,
      timed: a.timed,
      startedAt: iso(a.started_at),
      attemptExpiresAt: iso(a.expires_at),
      activeSection: active ? await this.sectionDTO(c, a, active) : null,
      nextSectionId:
        strict && !active
          ? (sections.find((s) => s.status === 'NOT_STARTED')?.section_id ??
            null)
          : null,
      sheet: strict ? null : await this.sheet(c, a),
    };
  }
  private async startModule(c: PoolClient, a: Row, m: Row, at: Date) {
    await c.query(
      "UPDATE attempt_module SET status='IN_PROGRESS',started_at=$2,expires_at=$3,updated_at=$2 WHERE id=$1",
      [m.id, at, minTime(plus(at, m.duration_seconds), a.expires_at)],
    );
  }
  async startSection(c: PoolClient, a: Row, s: Row, at: Date) {
    const modules = await this.modules(c, a, s.section_id),
      timed = moduleTimed(modules);
    await c.query(
      "UPDATE attempt_section SET status='IN_PROGRESS',started_at=$2,expires_at=$3,updated_at=$2 WHERE id=$1",
      [
        s.id,
        at,
        minTime(timed ? null : plus(at, s.duration_seconds), a.expires_at),
      ],
    );
    if (timed) await this.startModule(c, a, modules[0], at);
  }
  async start(r: ReadRequest, rawId: string, input: unknown) {
    const id = academicUuid(rawId, r, 'assessmentId'),
      body = takingBody('start', input, r);
    this.student(r);
    try {
      return await this.db.writeTransaction(async (c) => {
        const now = new Date(),
          assessment = await this.author.require(c, id, r);
        if (assessment.status !== 'PUBLISHED')
          this.fail(r, 400, 'Đề thi chưa được PUBLISHED');
        if (
          assessment.available_from &&
          millis(assessment.available_from) > now.getTime()
        )
          this.fail(r, 400, 'Đề thi chưa đến thời gian mở');
        if (
          assessment.available_until &&
          millis(assessment.available_until) < now.getTime()
        )
          this.fail(r, 400, 'Đề thi đã quá thời gian mở');
        const active = (
          await c.query(
            "SELECT id FROM attempt WHERE assessment_id=$1 AND student_id=$2 AND status='STARTED'",
            [id, r.user.id],
          )
        ).rows[0];
        if (active)
          return this.startDTO(c, await this.attempt(c, active.id, r));
        const assignment = (
          await c.query(
            'SELECT * FROM assessment_assignments WHERE assessment_id=$1 AND student_id=$2',
            [id, r.user.id],
          )
        ).rows[0];
        if (assessment.access_mode === 'ASSIGNED_ONLY' && !assignment)
          this.fail(r, 403, 'Bạn không được phân công làm bài thi này');
        if (assignment?.due_at && millis(assignment.due_at) < now.getTime())
          this.fail(r, 400, 'Đã quá hạn nộp bài (dueAt) được giao');
        const count = Number(
          (
            await c.query(
              'SELECT count(*) AS n FROM attempt WHERE assessment_id=$1 AND student_id=$2',
              [id, r.user.id],
            )
          ).rows[0].n,
        );
        if (count >= assessment.max_attempts)
          this.fail(
            r,
            409,
            `Bạn đã sử dụng hết số lượt làm bài cho phép (${assessment.max_attempts} lượt)`,
          );
        const sections = (
          await c.query(
            'SELECT * FROM assessment_sections WHERE assessment_id=$1 AND deleted_at IS NULL ORDER BY order_index',
            [id],
          )
        ).rows;
        if (!sections.length) this.fail(r, 400, 'Đề thi không có Section nào');
        const attemptId = randomUUID(),
          strict = assessment.timing_mode === 'STRICT';
        await c.query(
          "INSERT INTO attempt(id,assessment_id,student_id,status,started_at,expires_at,last_activity_at,attempt_number,timed,created_at,updated_at) VALUES($1,$2,$3,'STARTED',$4,$5,$4,$6,$7,$4,$4)",
          [
            attemptId,
            id,
            r.user.id,
            now,
            minTime(assignment?.due_at ?? null, assessment.available_until),
            count + 1,
            strict || (assessment.type === 'TEST' && body.timed !== false),
          ],
        );
        const attempt = await this.attempt(c, attemptId, r);
        for (const sec of sections) {
          await c.query(
            "INSERT INTO attempt_section(id,attempt_id,section_id,status,time_spent_seconds,created_at,updated_at) VALUES($1,$2,$3,'NOT_STARTED',0,$4,$4)",
            [randomUUID(), attemptId, sec.id, now],
          );
          for (const m of (
            await c.query(
              'SELECT * FROM assessment_modules WHERE section_id=$1 AND deleted_at IS NULL ORDER BY order_index',
              [sec.id],
            )
          ).rows) {
            await c.query(
              "INSERT INTO attempt_module(id,attempt_id,module_id,status,time_spent_seconds,created_at,updated_at) VALUES($1,$2,$3,'NOT_STARTED',0,$4,$4)",
              [randomUUID(), attemptId, m.id, now],
            );
            await c.query(
              'INSERT INTO attempt_question(id,attempt_id,assessment_question_id,created_at,updated_at) SELECT gen_random_uuid(),$1,q.id,$3,$3 FROM assessment_questions q JOIN question live ON live.id=q.question_id AND live.deleted_at IS NULL WHERE q.module_id=$2 ORDER BY q.position',
              [attemptId, m.id, now],
            );
          }
        }
        if (strict)
          await this.startSection(
            c,
            attempt,
            (await this.sections(c, attempt))[0],
            now,
          );
        return this.startDTO(c, attempt);
      }, 'assessment');
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith('23'))
        this.fail(r, 409, 'Dữ liệu bị trùng hoặc đang được sử dụng');
      throw error;
    }
  }
  async read(action: string, r: ReadRequest, rawId: string) {
    const id = academicUuid(rawId, r, 'attemptId');
    if (!['result', 'review'].includes(action)) this.student(r);
    return this.db.readSnapshot(async (c) => {
      const a = await this.attempt(c, id, r),
        now = new Date();
      if (['result', 'review'].includes(action)) {
        if (
          !r.user.roles.includes('ADMIN') &&
          a.assessment.owner_id !== r.user.id &&
          a.student_id !== r.user.id
        )
          this.fail(r, 403, 'Bạn không có quyền truy cập lượt thi này');
        if (a.status !== 'SUBMITTED')
          this.fail(r, 409, 'Bài thi chưa được nộp.');
        return action === 'result'
          ? this.submitDTO(c, a, now)
          : this.reviewDTO(c, a, r, now);
      }
      this.own(a, r);
      if (action === 'clock') {
        let active = null;
        if (a.assessment.timing_mode === 'STRICT' && a.status === 'STARTED') {
          active = (
            await c.query(
              "SELECT expires_at FROM attempt_module WHERE attempt_id=$1 AND status='IN_PROGRESS'",
              [id],
            )
          ).rows[0];
          if (!active)
            active = (
              await c.query(
                "SELECT expires_at FROM attempt_section WHERE attempt_id=$1 AND status='IN_PROGRESS'",
                [id],
              )
            ).rows[0];
        }
        return {
          serverNow: now.toISOString(),
          status: a.status,
          attemptExpiresAt: iso(a.expires_at),
          activeExpiresAt: iso(active?.expires_at),
        };
      }
      const sections = await this.sections(c, a);
      if (action === 'current-section') {
        this.strict(a, r);
        const current = sections.find((s) => s.status === 'IN_PROGRESS');
        if (!current)
          this.fail(r, 400, 'Không có section nào đang mở (IN_PROGRESS)');
        return this.sectionDTO(c, a, current);
      }
      if (a.status === 'SUBMITTED')
        this.fail(r, 409, 'Bài thi này đã được nộp.');
      const start = await this.startDTO(c, a),
        progress = [];
      for (const sec of sections) {
        const modules = await this.modules(c, a, sec.section_id);
        progress.push({
          id: sec.section_id,
          name: sec.name,
          code: sec.code,
          orderIndex: sec.order_index,
          durationSeconds: moduleTimed(modules)
            ? modules.reduce((n, m) => n + m.duration_seconds, 0)
            : sec.duration_seconds,
          status: sec.status,
          startedAt: iso(sec.started_at),
          completedAt: iso(sec.completed_at),
        });
      }
      const savedAnswers: Row = {},
        flaggedQuestionIds = [];
      for (const q of (
        await c.query('SELECT * FROM attempt_question WHERE attempt_id=$1', [
          id,
        ])
      ).rows) {
        if (q.answer_data !== null)
          savedAnswers[q.assessment_question_id] = q.answer_data;
        if (q.is_flagged) flaggedQuestionIds.push(q.assessment_question_id);
      }
      return {
        ...start,
        assessmentType: a.assessment.type,
        mode: a.assessment.mode,
        examType: a.assessment.exam_type,
        serverNow: now.toISOString(),
        sections: progress,
        savedAnswers,
        flaggedQuestionIds,
      };
    });
  }
  private async editable(
    c: PoolClient,
    a: Row,
    q: Row,
    r: ReadRequest,
    now: Date,
  ) {
    if (a.expires_at && millis(a.expires_at) + 5000 < now.getTime())
      this.fail(r, 409, 'Hạn nộp toàn bài đã hết');
    if (a.assessment.timing_mode !== 'STRICT') return null;
    const sections = await this.sections(c, a),
      sec = sections.find((s) => s.section_id === q.section_id);
    const open = (m: Row) =>
      (m.status === 'IN_PROGRESS' &&
        (m.expires_at === null ||
          now.getTime() <= millis(m.expires_at) + 5000)) ||
      (m.status === 'EXPIRED' &&
        m.expires_at !== null &&
        now.getTime() <= millis(m.expires_at) + 5000);
    if (sec) {
      const modules = await this.modules(c, a, sec.section_id);
      if (moduleTimed(modules)) {
        const own = modules.find((m) => m.module_id === q.module_id);
        if (own && open(own)) return own.started_at;
        if (own?.status === 'IN_PROGRESS')
          this.fail(r, 409, 'Module này đã hết giờ, không thể lưu đáp án');
        if (sec.status === 'IN_PROGRESS')
          this.fail(r, 409, 'Câu hỏi không thuộc Module đang mở');
      } else {
        if (open(sec)) return sec.started_at;
        if (sec.status === 'IN_PROGRESS')
          this.fail(r, 409, 'Section này đã hết giờ, không thể lưu đáp án');
      }
    }
    if (!sections.some((s) => s.status === 'IN_PROGRESS'))
      this.fail(r, 409, 'Không có section nào đang mở để lưu đáp án');
    this.fail(r, 409, 'Câu hỏi không thuộc Section đang mở');
  }
  async closeModule(c: PoolClient, m: Row, status: string, at: Date) {
    await c.query(
      'UPDATE attempt_module SET status=$2,completed_at=$3,time_spent_seconds=$4,updated_at=$5 WHERE id=$1',
      [m.id, status, at, elapsed(m.started_at, m.expires_at, at), new Date()],
    );
  }
  async closeSection(c: PoolClient, a: Row, s: Row, status: string, at: Date) {
    for (const m of await this.modules(c, a, s.section_id)) {
      if (closed(m.status)) continue;
      const state =
        m.status === 'IN_PROGRESS' && status === 'COMPLETED'
          ? m.expires_at && millis(m.expires_at) < at.getTime()
            ? 'EXPIRED'
            : 'COMPLETED'
          : status;
      await this.closeModule(c, m, state, at);
    }
    await c.query(
      'UPDATE attempt_section SET status=$2,completed_at=$3,time_spent_seconds=$4,updated_at=$5 WHERE id=$1',
      [s.id, status, at, elapsed(s.started_at, s.expires_at, at), new Date()],
    );
  }
  async allClosed(c: PoolClient, a: Row) {
    return (await this.sections(c, a)).every((s) => closed(s.status));
  }
  async advanceModule(
    c: PoolClient,
    a: Row,
    s: Row,
    m: Row,
    at: Date,
    now: Date,
  ) {
    const modules = await this.modules(c, a, s.section_id),
      next = modules
        .slice(modules.findIndex((x) => x.id === m.id) + 1)
        .find((x) => x.status === 'NOT_STARTED');
    const deadline = reached(a.expires_at, at);
    if (next && !deadline) {
      await this.startModule(c, a, next, at);
      return;
    }
    await this.closeSection(c, a, s, deadline ? 'EXPIRED' : m.status, at);
    if (deadline) await this.doSubmit(c, a, 'DEADLINE_EXPIRED', now);
    else if (await this.allClosed(c, a))
      await this.doSubmit(c, a, 'SECTIONS_COMPLETED', now);
  }
  async write(
    action: string,
    r: ReadRequest,
    rawId: string,
    input?: unknown,
    rawPart?: string,
  ) {
    const id = academicUuid(rawId, r, 'attemptId'),
      part =
        rawPart === undefined
          ? undefined
          : academicUuid(
              rawPart,
              r,
              action === 'module-complete' ? 'moduleId' : 'sectionId',
            ),
      body = ['answers', 'flag', 'question-time'].includes(action)
        ? takingBody(action, input, r)
        : null;
    this.student(r);
    if (
      action === 'answers' &&
      body!.answerData !== null &&
      JSON.stringify(body!.answerData).length > 4096
    )
      this.fail(r, 400, 'Đáp án quá dài (tối đa 4096 ký tự)');
    return this.db.writeTransaction(async (c) => {
      const a = await this.attempt(c, id, r, true),
        now = new Date();
      this.own(a, r);
      if (action === 'submit') {
        if (a.status !== 'SUBMITTED')
          await this.doSubmit(
            c,
            a,
            reached(a.expires_at, now) ? 'DEADLINE_EXPIRED' : 'STUDENT_SUBMIT',
            now,
          );
        return this.submitDTO(c, a, now);
      }
      if (['answers', 'flag', 'question-time'].includes(action)) {
        this.started(a, r);
        if (action === 'question-time' && a.assessment.timing_mode !== 'STRICT')
          this.fail(
            r,
            409,
            'Chỉ ghi nhận thời gian từng câu cho bài thi tính giờ nghiêm ngặt (STRICT)',
          );
        const entries: Row[] =
          action === 'question-time' ? body!.entries : [body!];
        const requested = new Map<string, number>();
        for (const e of entries)
          requested.set(
            e.assessmentQuestionId,
            ((requested.get(e.assessmentQuestionId) ?? 0) + (e.seconds ?? 0)) |
              0,
          );
        const rows = [];
        let earliest: any = null;
        for (const questionId of requested.keys()) {
          const q = (
            await c.query(
              'SELECT t.*,q.section_id,q.module_id FROM attempt_question t JOIN assessment_questions q ON q.id=t.assessment_question_id WHERE t.attempt_id=$1 AND q.id=$2',
              [id, questionId],
            )
          ).rows[0];
          if (!q) this.fail(r, 400, 'Câu hỏi không tồn tại trong bài thi này');
          const start = await this.editable(c, a, q, r, now);
          if (start && (earliest === null || millis(start) < millis(earliest)))
            earliest = start;
          rows.push(q);
        }
        if (action === 'question-time') {
          let budgetStart = a.time_reported_at ?? a.started_at;
          if (earliest && millis(earliest) > millis(budgetStart))
            budgetStart = earliest;
          const budget = Math.max(
              0,
              Math.floor((now.getTime() - millis(budgetStart)) / 1000),
            ),
            total = [...requested.values()].reduce((n, x) => n + x, 0);
          let accepted = 0;
          for (const q of rows) {
            const seconds = requested.get(q.assessment_question_id)!;
            const granted =
              total <= budget
                ? seconds
                : Math.trunc((seconds * budget) / total);
            if (granted <= 0) continue;
            await c.query(
              'UPDATE attempt_question SET time_spent_seconds=time_spent_seconds+$2,first_viewed_at=coalesce(first_viewed_at,$3),last_viewed_at=$3,updated_at=$3 WHERE id=$1',
              [q.id, granted, now],
            );
            accepted += granted;
          }
          await c.query(
            'UPDATE attempt SET time_reported_at=$2,last_activity_at=$2,updated_at=$2 WHERE id=$1',
            [id, now],
          );
          return { acceptedSeconds: accepted };
        }
        const q = rows[0];
        if (action === 'answers')
          await c.query(
            'UPDATE attempt_question SET answer_data=$2::jsonb,answer_status=$3,last_viewed_at=$4,updated_at=$4 WHERE id=$1',
            [
              q.id,
              body!.answerData === null
                ? null
                : JSON.stringify(body!.answerData),
              body!.answerData === null ? 'UNANSWERED' : 'ANSWERED',
              now,
            ],
          );
        else
          await c.query(
            'UPDATE attempt_question SET is_flagged=$2,last_viewed_at=$3,updated_at=$3 WHERE id=$1',
            [q.id, body!.isFlagged, now],
          );
        await c.query(
          'UPDATE attempt SET last_activity_at=$2,updated_at=$2 WHERE id=$1',
          [id, now],
        );
        return undefined;
      }
      this.strict(a, r);
      const sections = await this.sections(c, a);
      let s = sections.find((x) => x.section_id === part);
      if (action === 'module-complete') {
        const module = (
          await c.query(
            'SELECT t.*,m.section_id,m.duration_seconds,m.order_index FROM attempt_module t JOIN assessment_modules m ON m.id=t.module_id WHERE t.attempt_id=$1 AND t.module_id=$2',
            [id, part],
          )
        ).rows[0];
        if (!module)
          this.fail(
            r,
            404,
            `Không tìm thấy module trong bài thi với id: ${part}`,
          );
        s = sections.find((x) => x.section_id === module.section_id);
        if (!s)
          this.fail(
            r,
            404,
            `Không tìm thấy section trong bài thi với id: ${module.section_id}`,
          );
        if (!closed(module.status)) {
          this.started(a, r);
          if (!moduleTimed(await this.modules(c, a, s.section_id)))
            this.fail(
              r,
              409,
              'Section này tính giờ chung cho cả Section, hãy kết thúc Section thay vì Module',
            );
          if (module.status === 'NOT_STARTED')
            this.fail(r, 409, 'Không thể kết thúc Module chưa được bắt đầu');
          module.status =
            module.expires_at && millis(module.expires_at) < now.getTime()
              ? 'EXPIRED'
              : 'COMPLETED';
          await this.closeModule(c, module, module.status, now);
          await this.advanceModule(c, a, s, module, now, now);
        }
        return this.moduleCompletion(c, a, s.section_id);
      }
      if (action === 'section-start') {
        this.started(a, r);
        if (a.expires_at && millis(a.expires_at) < now.getTime()) {
          await this.doSubmit(c, a, 'DEADLINE_EXPIRED', now);
          this.fail(r, 409, 'Hạn nộp toàn bài đã hết, bài thi đã được nộp');
        }
      }
      if (!s)
        this.fail(
          r,
          404,
          `Không tìm thấy section trong bài thi với id: ${part}`,
        );
      if (action === 'section-complete') {
        if (!closed(s.status)) {
          this.started(a, r);
          if (s.status === 'NOT_STARTED')
            this.fail(r, 409, 'Không thể kết thúc Section chưa được bắt đầu');
          await this.closeSection(
            c,
            a,
            s,
            s.expires_at && millis(s.expires_at) < now.getTime()
              ? 'EXPIRED'
              : 'COMPLETED',
            now,
          );
          if (await this.allClosed(c, a))
            await this.doSubmit(c, a, 'SECTIONS_COMPLETED', now);
        }
      } else if (s.status !== 'IN_PROGRESS') {
        if (closed(s.status))
          this.fail(r, 409, 'Section này đã kết thúc, không thể bắt đầu lại');
        for (const prev of sections)
          if (prev.order_index < s.order_index && !closed(prev.status))
            this.fail(r, 409, `Section trước đó (${prev.name}) chưa hoàn tất`);
        await this.startSection(c, a, s, now);
      }
      return this.sectionDTO(
        c,
        a,
        (await this.sections(c, a)).find((x) => x.section_id === part)!,
      );
    }, 'assessment');
  }
  private async moduleCompletion(c: PoolClient, a: Row, sectionId: string) {
    const sections = await this.sections(c, a),
      s = sections.find((x) => x.section_id === sectionId)!;
    return {
      section: await this.sectionDTO(c, a, s),
      nextSectionId:
        a.status === 'STARTED' && closed(s.status)
          ? (sections.find((x) => x.status === 'NOT_STARTED')?.section_id ??
            null)
          : null,
      attemptStatus: a.status,
    };
  }
  async doSubmit(c: PoolClient, a: Row, reason: string, now: Date) {
    const strict = a.assessment.timing_mode === 'STRICT';
    for (const sec of await this.sections(c, a))
      if (
        sec.status === 'IN_PROGRESS' ||
        (!strict && sec.status === 'NOT_STARTED')
      )
        await this.closeSection(
          c,
          a,
          sec,
          reached(a.expires_at, now)
            ? 'EXPIRED'
            : sec.expires_at && millis(sec.expires_at) < now.getTime()
              ? 'EXPIRED'
              : 'COMPLETED',
          now,
        );
    a.status = 'SUBMITTED';
    a.submission_reason = reason;
    a.submitted_at = now;
    await this.grade(
      c,
      a,
      Math.floor((now.getTime() - millis(a.started_at)) / 1000),
    );
    await c.query(
      "UPDATE attempt SET status='SUBMITTED',submission_reason=$2,submitted_at=$3,updated_at=$3 WHERE id=$1",
      [a.id, reason, now],
    );
  }
  async grade(c: PoolClient, a: Row, totalTime: number) {
    const rows = (
      await c.query(
        'SELECT t.*,q.points,q.section_id,v.snapshot FROM attempt_question t JOIN assessment_questions q ON q.id=t.assessment_question_id JOIN question_version v ON v.id=q.question_version_id WHERE t.attempt_id=$1',
        [a.id],
      )
    ).rows;
    let earned = 0,
      max = 0;
    const sections = new Map<string, Row>(),
      topics = new Map<string, Row>();
    for (const q of rows) {
      const points = Math.round(Number(q.points ?? 1) * 100);
      max += points;
      const correct =
        q.answer_status !== 'UNANSWERED' &&
        q.answer_data !== null &&
        evaluate(q.snapshot, q.answer_data);
      if (correct) earned += points;
      const topicIds = [...new Set<string>(q.snapshot.topicIds ?? [])];
      for (const [map, keys] of [
        [sections, q.section_id ? [q.section_id] : []],
        [topics, topicIds],
      ] as [Map<string, Row>, string[]][]) {
        for (const key of keys) {
          if (!map.has(key)) map.set(key, { earned: 0, max: 0 });
          const total = map.get(key)!;
          total.max += points;
          if (correct) total.earned += points;
        }
      }
      const status = correct
        ? 'CORRECT'
        : q.answer_status !== 'UNANSWERED' &&
            q.answer_data !== null &&
            ['SHORT_ANSWER', 'ESSAY'].includes(q.snapshot.questionType)
          ? 'PENDING_REVIEW'
          : 'INCORRECT';
      await c.query(
        'UPDATE attempt_question SET grading_status=$2,points_earned=$3,updated_at=$4 WHERE id=$1',
        [q.id, status, correct ? points / 100 : 0, new Date()],
      );
    }
    const breakdown = {
      sections: [...sections].map(([sectionId, v]) => ({
        sectionId,
        pointsEarned: v.earned / 100,
        maxPoints: v.max / 100,
      })),
      topics: [...topics].map(([topicId, v]) => ({
        topicId,
        pointsEarned: v.earned / 100,
        maxPoints: v.max / 100,
      })),
    };
    await c.query(
      'INSERT INTO results(id,attempt_id,total_grade,max_grade,total_time,ranking,grade_breakdown,created_at,updated_at) VALUES($1,$2,$3,$4,$5,NULL,$6::jsonb,$7,$7) ON CONFLICT(attempt_id) DO UPDATE SET total_grade=EXCLUDED.total_grade,max_grade=EXCLUDED.max_grade,total_time=EXCLUDED.total_time,ranking=NULL,grade_breakdown=EXCLUDED.grade_breakdown,updated_at=EXCLUDED.updated_at',
      [
        randomUUID(),
        a.id,
        earned / 100,
        max / 100,
        totalTime,
        JSON.stringify(breakdown),
        new Date(),
      ],
    );
  }
  async released(c: PoolClient, a: Row, now: Date) {
    if (a.status !== 'SUBMITTED') return false;
    const pending = (
      await c.query(
        "SELECT 1 FROM attempt_question WHERE attempt_id=$1 AND grading_status IN ('UNGRADED','PENDING_REVIEW') LIMIT 1",
        [a.id],
      )
    ).rowCount;
    if (pending) return false;
    const s = a.assessment;
    if (s.release_policy === 'IMMEDIATE') return true;
    if (s.release_policy === 'MANUAL') return s.results_released_at !== null;
    const release = s.results_release_at ?? s.available_until;
    return release !== null && millis(release) <= now.getTime();
  }
  async submitDTO(c: PoolClient, a: Row, now: Date) {
    const released = await this.released(c, a, now);
    let result = null;
    if (released) {
      const row = (
        await c.query('SELECT * FROM results WHERE attempt_id=$1', [a.id])
      ).rows[0];
      if (row)
        result = {
          resultId: row.id,
          attemptId: a.id,
          assessmentId: a.assessment_id,
          totalGrade: Number(row.total_grade),
          maxGrade: Number(row.max_grade),
          totalTimeSeconds: row.total_time,
          ranking: row.ranking === null ? null : Number(row.ranking),
          gradeBreakdown: row.grade_breakdown,
          note: row.note,
          createdAt: iso(row.created_at),
        };
    }
    return {
      attemptId: a.id,
      status: a.status,
      submissionReason: a.submission_reason,
      submittedAt: iso(a.submitted_at),
      resultAvailable: released,
      message: released
        ? 'Bài thi đã được nộp và chấm điểm thành công.'
        : 'Bài thi đã được nộp thành công. Điểm số và lời giải sẽ được công bố theo thông báo của giáo viên / sau hạn nộp.',
      result,
    };
  }
  async reviewDTO(c: PoolClient, a: Row, r: ReadRequest, now: Date) {
    if (
      !r.user.roles.includes('ADMIN') &&
      a.assessment.owner_id !== r.user.id &&
      !(await this.released(c, a, now))
    )
      this.fail(
        r,
        403,
        'Kết quả và lời giải của bài thi này chưa được công bố',
      );
    const rows = (
      await c.query(
        'SELECT t.*,q.id AS qid,q.position,q.points,q.section_id,q.module_id,v.snapshot,s.name AS section_name,m.name AS module_name FROM attempt_question t JOIN assessment_questions q ON q.id=t.assessment_question_id JOIN question_version v ON v.id=q.question_version_id LEFT JOIN assessment_sections s ON s.id=q.section_id LEFT JOIN assessment_modules m ON m.id=q.module_id WHERE t.attempt_id=$1 ORDER BY s.order_index,m.order_index,q.position',
        [a.id],
      )
    ).rows;
    const questions = [];
    for (const row of rows) {
      const view = this.takingQuestion({ ...row, id: row.qid }),
        topicIds = [...new Set(row.snapshot.topicIds ?? [])];
      const topics = topicIds.length
        ? (
            await c.query(
              'SELECT id,name FROM topic WHERE id=ANY($1::uuid[]) ORDER BY name',
              [topicIds],
            )
          ).rows
        : [];
      const { moduleId, ...rest } = view;
      questions.push({
        ...rest,
        sectionId: row.section_id,
        sectionName: row.section_name,
        moduleId,
        moduleName: row.module_name,
        pointsEarned: Number(row.points_earned),
        answerStatus: row.answer_status,
        gradingStatus: row.grading_status,
        isFlagged: row.is_flagged,
        feedback: row.feedback,
        studentAnswer: row.answer_data,
        correctAnswer: row.snapshot.answer ?? null,
        explanation: row.snapshot.explanation ?? null,
        timeSpentSeconds: row.time_spent_seconds,
        topics,
      });
    }
    const modules = [];
    for (const section of await this.sections(c, a))
      for (const m of await this.modules(c, a, section.section_id))
        modules.push({
          id: m.module_id,
          sectionId: section.section_id,
          durationSeconds: m.duration_seconds,
          questionCount: questions.filter((q) => q.moduleId === m.module_id)
            .length,
        });
    const result = (
      await c.query('SELECT * FROM results WHERE attempt_id=$1', [a.id])
    ).rows[0];
    return {
      attemptId: a.id,
      assessmentId: a.assessment_id,
      assessmentTitle: a.assessment.title,
      assessmentType: a.assessment.type,
      examType: a.assessment.exam_type,
      timingMode: a.assessment.timing_mode,
      timed: a.timed,
      attemptNumber: a.attempt_number,
      submittedAt: iso(a.submitted_at),
      totalGrade: Number(result?.total_grade ?? 0),
      maxGrade: Number(result?.max_grade ?? 0),
      modules,
      questions,
    };
  }
}
