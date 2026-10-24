import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';
import { apiError } from '../read-api/auth.guard.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { academicUuid } from '../read-api/academic.service.js';
import { parsePaging, parseSort } from '../read-api/paging.js';
import { javaTrim } from '../academic-write/question.binding.js';
import { resolveVocabularyZone } from '../vocabulary/vocabulary.service.js';
import { AssessmentAuthoringService } from './authoring.service.js';
import type { Row } from './assessment.binding.js';
const cents = (value: any) => {
  const s = String(value ?? 0),
    negative = s.startsWith('-'),
    [whole, fraction = ''] = s.replace(/^-/, '').split('.');
  const result = BigInt(whole!) * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -result : result;
};
const rounded = (n: bigint, d: bigint, scale: number) => {
  const abs = n < 0n ? -n : n,
    unit = 10n ** BigInt(scale),
    result = (2n * abs * unit + d) / (2n * d);
  return n < 0n ? -result : result;
};
const iso = (v: any) =>
  v === null || v === undefined ? null : new Date(v).toISOString();
const skills: Record<string, string[]> = {
  MATH: ['MATH', 'ALG', 'GEO', 'CALC', 'NUM'],
  VERBAL: ['RW', 'READ', 'WRIT', 'VERBAL', 'ENGLISH', 'GRAMMAR'],
  READING: ['READ'],
  LISTENING: ['LISTEN'],
  WRITING: ['WRIT'],
  SPEAKING: ['SPEAK'],
};
const lengths = ['UNDER_30', 'FROM_30_TO_60', 'OVER_60'],
  statuses = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];
const columns = {
  id: 'a.id',
  title: 'a.title',
  description: 'a.description',
  type: 'a.type',
  status: 'a.status',
  mode: 'a.mode',
  examType: 'a.exam_type',
  timingMode: 'a.timing_mode',
  createdAt: 'a.created_at',
  updatedAt: 'a.updated_at',
  durationSeconds: 'a.duration_seconds',
  availableFrom: 'a.available_from',
  availableUntil: 'a.available_until',
  maxAttempts: 'a.max_attempts',
  releasePolicy: 'a.release_policy',
  accessMode: 'a.access_mode',
};
@Injectable()
export class AssessmentCatalogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly author: AssessmentAuthoringService,
  ) {}
  private filter(q: Row, r: ReadRequest, facets = false) {
    const out: Row = {};
    const sets: Record<string, string[]> = {
      category: ['PRACTICE', 'PERFORMANCE', 'HOMEWORK', 'DRILL'],
      skill: Object.keys(skills),
      length: lengths,
      status: statuses,
    };
    for (const key of ['category', 'skill', 'length', 'status', 'exam']) {
      const raw = q[key];
      const values =
        raw === undefined
          ? []
          : Array.isArray(raw)
            ? raw
            : String(raw).split(',');
      out[key] = [...new Set(values.map((v: any) => String(v).trim()))];
      if (key === 'exam')
        out[key] = out[key].map((s: string) => s.toUpperCase());
      else if (out[key].some((s: string) => s && !sets[key]!.includes(s)))
        throw apiError(400, `Tham số '${key}' không đúng định dạng`, r.path);
      // Empty set syntax is valid; an empty enum token inside a nonempty set follows Spring's null element handling.
      out[key] = out[key].filter(Boolean);
    }
    out.type = facets
      ? null
      : q.type === undefined || q.type === ''
        ? null
        : String(q.type).trim();
    if (out.type && !['TEST', 'DRILL', 'HOMEWORK'].includes(out.type))
      throw apiError(400, "Tham số 'type' không đúng định dạng", r.path);
    for (const key of ['minDurationSeconds', 'maxDurationSeconds']) {
      out[key] = null;
      if (!facets && q[key] !== undefined && q[key] !== '') {
        if (
          !/^[+-]?\d+$/.test(String(q[key])) ||
          !Number.isInteger(Number(q[key])) ||
          Number(q[key]) < -2147483648 ||
          Number(q[key]) > 2147483647
        )
          throw apiError(400, `Tham số '${key}' không đúng định dạng`, r.path);
        out[key] = Number(q[key]);
      }
    }
    out.q = q.q === undefined ? null : String(q.q);
    return out;
  }
  private query(r: ReadRequest, f: Row) {
    const params: unknown[] = [r.user.id, new Date()];
    const bind = (v: unknown) => {
      params.push(v);
      return '$' + params.length;
    };
    const clauses = [
      "a.deleted_at IS NULL AND a.status='PUBLISHED'",
      '(a.available_from IS NULL OR a.available_from<=$2)',
      '(a.available_until IS NULL OR a.available_until>=$2)',
      `EXISTS(SELECT 1 FROM assessment_questions q WHERE q.assessment_id=a.id)`,
      `(EXISTS(SELECT 1 FROM attempt t WHERE t.assessment_id=a.id AND t.student_id=$1 AND t.status='STARTED') OR ((a.access_mode='OPEN' OR EXISTS(SELECT 1 FROM assessment_assignments x WHERE x.assessment_id=a.id AND x.student_id=$1)) AND NOT EXISTS(SELECT 1 FROM assessment_assignments x WHERE x.assessment_id=a.id AND x.student_id=$1 AND x.due_at<$2)))`,
    ];
    if (f.type) clauses.push('a.type=' + bind(f.type));
    const escape = (v: string) => v.replace(/[\\%_]/g, '\\$&');
    if (f.q !== null && f.q.trim()) {
      const p = bind('%' + escape(javaTrim(f.q).toLowerCase()) + '%');
      clauses.push(
        `(lower(a.title) LIKE ${p} ESCAPE '\\' OR lower(coalesce(a.exam_type,'')) LIKE ${p} ESCAPE '\\')`,
      );
    }
    if (f.category.length)
      clauses.push(
        '(' +
          f.category
            .map((v: string) =>
              v === 'PRACTICE'
                ? "(a.type='TEST' AND lower(coalesce(a.mode,'')) NOT LIKE '%performance%')"
                : v === 'PERFORMANCE'
                  ? "(a.type='TEST' AND lower(coalesce(a.mode,'')) LIKE '%performance%')"
                  : 'a.type=' + bind(v),
            )
            .join(' OR ') +
          ')',
      );
    if (f.exam.length)
      clauses.push(
        '(' +
          f.exam
            .map(
              (v: string) =>
                `upper(coalesce(a.exam_type,'')) LIKE ${bind('%' + escape(v) + '%')} ESCAPE '\\'`,
            )
            .join(' OR ') +
          ')',
      );
    if (f.skill.length) {
      const conditions = f.skill.flatMap((s: string) =>
        skills[s]!.flatMap((v) => {
          const p = bind('%' + v + '%');
          return [
            `upper(coalesce(s.name,'')) LIKE ${p}`,
            `upper(coalesce(s.code,'')) LIKE ${p}`,
          ];
        }),
      );
      clauses.push(
        `EXISTS(SELECT 1 FROM assessment_sections s WHERE s.assessment_id=a.id AND s.deleted_at IS NULL AND (${conditions.join(' OR ')}))`,
      );
    }
    if (f.length.length)
      clauses.push(
        '(' +
          f.length
            .map((v: string) =>
              v === 'UNDER_30'
                ? "(a.type<>'TEST' OR coalesce(a.duration_seconds,0)<1770)"
                : v === 'FROM_30_TO_60'
                  ? "(a.type='TEST' AND coalesce(a.duration_seconds,0)>=1770 AND coalesce(a.duration_seconds,0)<3630)"
                  : "(a.type='TEST' AND coalesce(a.duration_seconds,0)>=3630)",
            )
            .join(' OR ') +
          ')',
      );
    const active =
        "EXISTS(SELECT 1 FROM attempt t WHERE t.assessment_id=a.id AND t.student_id=$1 AND t.status='STARTED')",
      submitted =
        'EXISTS(SELECT 1 FROM attempt t WHERE t.assessment_id=a.id AND t.student_id=$1 AND t.submitted_at IS NOT NULL)';
    if (f.status.length)
      clauses.push(
        '(' +
          f.status
            .map((v: string) =>
              v === 'IN_PROGRESS'
                ? active
                : v === 'COMPLETED'
                  ? `(NOT ${active} AND ${submitted})`
                  : `(NOT ${active} AND NOT ${submitted})`,
            )
            .join(' OR ') +
          ')',
      );
    if (f.minDurationSeconds !== null)
      clauses.push('a.duration_seconds>=' + bind(f.minDurationSeconds));
    else if (f.maxDurationSeconds !== null)
      clauses.push('a.duration_seconds IS NOT NULL');
    if (f.maxDurationSeconds !== null)
      clauses.push('a.duration_seconds<=' + bind(f.maxDurationSeconds));
    return { where: clauses.join(' AND '), params };
  }
  private released(a: Row, now: Date) {
    if (a.release_policy === 'IMMEDIATE') return true;
    if (a.release_policy === 'MANUAL') return a.results_released_at !== null;
    const at = a.results_release_at ?? a.available_until;
    return at !== null && new Date(at) <= now;
  }
  private async structure(c: PoolClient, assessmentId: string) {
    const sections = [];
    for (const s of (
      await c.query(
        'SELECT * FROM assessment_sections WHERE assessment_id=$1 AND deleted_at IS NULL ORDER BY order_index',
        [assessmentId],
      )
    ).rows) {
      const modules = (
        await c.query(
          'SELECT m.*, (SELECT count(*)::int FROM assessment_questions q WHERE q.module_id=m.id) AS n FROM assessment_modules m WHERE section_id=$1 AND deleted_at IS NULL ORDER BY order_index',
          [s.id],
        )
      ).rows;
      sections.push({
        id: s.id,
        name: s.name,
        code: s.code,
        durationSeconds:
          modules.length && modules.every((m) => m.duration_seconds !== null)
            ? modules.reduce((n, m) => n + m.duration_seconds, 0)
            : s.duration_seconds,
        modules: modules.map((m) => ({
          id: m.id,
          name: m.name,
          code: m.code,
          durationSeconds: m.duration_seconds,
          questionCount: m.n,
        })),
      });
    }
    return sections;
  }
  private async item(c: PoolClient, a: Row, r: ReadRequest) {
    const sections = await this.structure(c, a.id),
      spread = (
        await c.query(
          'SELECT q.difficulty,count(*)::int AS n FROM assessment_questions x JOIN question q ON q.id=x.question_id AND q.deleted_at IS NULL WHERE x.assessment_id=$1 GROUP BY q.difficulty',
          [a.id],
        )
      ).rows;
    let difficulty = null,
      most = 0;
    for (const value of ['EASY', 'MEDIUM', 'HARD']) {
      const count = spread.find((x) => x.difficulty === value)?.n ?? 0;
      if (count > 0 && count >= most) {
        difficulty = value;
        most = count;
      }
    }
    const attempts = (
        await c.query(
          'SELECT * FROM attempt WHERE assessment_id=$1 AND student_id=$2',
          [a.id, r.user.id],
        )
      ).rows,
      active = attempts.find((t) => t.status === 'STARTED');
    let activeAttempt = null;
    if (active) {
      const counts = (
        await c.query(
          "SELECT count(*)::int AS questions,count(*) FILTER(WHERE answer_status='ANSWERED')::int AS answered FROM attempt_question WHERE attempt_id=$1",
          [active.id],
        )
      ).rows[0];
      activeAttempt = {
        attemptId: active.id,
        ...counts,
        expiresAt: iso(active.expires_at),
      };
    }
    const assignment = (
      await c.query(
        'SELECT due_at FROM assessment_assignments WHERE assessment_id=$1 AND student_id=$2',
        [a.id, r.user.id],
      )
    ).rows[0];
    const submitted = attempts
      .map((t) => t.submitted_at)
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      type: a.type,
      mode: a.mode,
      examType: a.exam_type,
      timingMode: a.timing_mode,
      questionCount: spread.reduce((n, s) => n + s.n, 0),
      durationSeconds: a.duration_seconds ?? 0,
      difficulty,
      sections,
      availableUntil: iso(a.available_until),
      dueAt: iso(assignment?.due_at),
      maxAttempts: a.max_attempts,
      attemptsUsed: attempts.length,
      lastSubmittedAt: iso(submitted[0]),
      activeAttempt,
    };
  }
  async read(action: string, r: ReadRequest, q: Row = {}, rawId?: string) {
    const id =
      rawId === undefined ? undefined : academicUuid(rawId, r, 'assessmentId');
    const f = ['catalog', 'facets', 'item'].includes(action)
      ? this.filter(q, r, action === 'facets')
      : null;
    if (!r.user.roles.includes('STUDENT'))
      throw apiError(403, 'Bạn không có quyền thực hiện thao tác này', r.path);
    return this.db.readSnapshot(async (c) => {
      if (action === 'stats') return this.stats(c, r);
      if (action === 'history') return this.history(c, r, q);
      if (action === 'facets') {
        const count = async (filter: Row) => {
          const query = this.query(r, filter);
          return Number(
            (
              await c.query(
                'SELECT count(*) AS n FROM assessments a WHERE ' + query.where,
                query.params,
              )
            ).rows[0].n,
          );
        };
        const exams: Row = {},
          skill: Row = {},
          length: Row = {},
          status: Row = {};
        for (const exam of ['ALL', 'IELTS', 'SAT']) {
          const next = exam === 'ALL' ? [] : [exam];
          exams[exam] = await count({
            ...f,
            exam: next,
            skill:
              JSON.stringify([...next].sort()) ===
              JSON.stringify([...f!.exam].sort())
                ? f!.skill
                : [],
          });
        }
        for (const value of Object.keys(skills))
          skill[value] = await count({ ...f, skill: [value] });
        for (const value of lengths)
          length[value] = await count({ ...f, length: [value] });
        for (const value of statuses)
          status[value] = await count({ ...f, status: [value] });
        return { exams, skills: skill, lengths: length, statuses: status };
      }
      const query = this.query(r, f!);
      if (action === 'item') {
        query.params.push(id);
        const a = (
          await c.query(
            'SELECT a.* FROM assessments a WHERE ' +
              query.where +
              ' AND a.id=$' +
              query.params.length,
            query.params,
          )
        ).rows[0];
        if (!a)
          throw apiError(404, `Không tìm thấy đề thi với id: ${id}`, r.path);
        return this.item(c, a, r);
      }
      const paging = parsePaging(q);
      const sort =
        parseSort(q, columns, r.path, [
          'title',
          'description',
          'mode',
          'examType',
        ]) || 'ORDER BY a.created_at DESC';
      const total = Number(
        (
          await c.query(
            'SELECT count(*) AS n FROM assessments a WHERE ' + query.where,
            query.params,
          )
        ).rows[0].n,
      );
      query.params.push(paging.size, paging.page * paging.size);
      const rows = (
        await c.query(
          `SELECT a.* FROM assessments a WHERE ${query.where} ${sort} LIMIT $${query.params.length - 1} OFFSET $${query.params.length}`,
          query.params,
        )
      ).rows;
      const content = [];
      for (const a of rows) content.push(await this.item(c, a, r));
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
  private async history(c: PoolClient, r: ReadRequest, q: Row) {
    const p = parsePaging(q),
      total = Number(
        (
          await c.query(
            "SELECT count(*) AS n FROM attempt t JOIN assessments a ON a.id=t.assessment_id AND a.deleted_at IS NULL WHERE t.student_id=$1 AND t.status='SUBMITTED'",
            [r.user.id],
          )
        ).rows[0].n,
      );
    const rows = (
      await c.query(
        "SELECT t.* FROM attempt t JOIN assessments a ON a.id=t.assessment_id AND a.deleted_at IS NULL WHERE t.student_id=$1 AND t.status='SUBMITTED' ORDER BY t.submitted_at DESC,t.id LIMIT $2 OFFSET $3",
        [r.user.id, p.size, p.page * p.size],
      )
    ).rows;
    const content = [];
    for (const t of rows) {
      const a = await this.author.require(c, t.assessment_id, r),
        result = (
          await c.query('SELECT * FROM results WHERE attempt_id=$1', [t.id])
        ).rows[0],
        available = !!result && this.released(a, new Date());
      const tallies = (
        await c.query(
          "SELECT m.section_id,count(*)::int AS questions,count(*) FILTER(WHERE t.grading_status='CORRECT')::int AS correct FROM attempt_question t JOIN assessment_questions q ON q.id=t.assessment_question_id JOIN assessment_modules m ON m.id=q.module_id AND m.deleted_at IS NULL WHERE t.attempt_id=$1 GROUP BY m.section_id",
          [t.id],
        )
      ).rows;
      const structure = await this.structure(c, a.id),
        sections = structure
          .filter((s) => tallies.some((x) => x.section_id === s.id))
          .map((s) => {
            const tally = tallies.find((x) => x.section_id === s.id)!;
            return {
              name: s.name,
              code: s.code,
              questionCount: tally.questions,
              correctCount: available ? tally.correct : null,
            };
          });
      content.push({
        attemptId: t.id,
        assessmentId: a.id,
        title: a.title,
        examType: a.exam_type,
        type: a.type,
        questionCount: tallies.reduce((n, x) => n + x.questions, 0),
        durationSeconds:
          a.type === 'TEST'
            ? structure.reduce((n, s) => n + (s.durationSeconds ?? 0), 0)
            : 0,
        submittedAt: iso(t.submitted_at),
        resultAvailable: available,
        totalGrade: available ? Number(result.total_grade ?? 0) : null,
        maxGrade: available ? Number(result.max_grade) : null,
        correctCount: available
          ? tallies.reduce((n, x) => n + x.correct, 0)
          : null,
        sections,
      });
    }
    return {
      content,
      page: {
        size: p.size,
        number: p.page,
        totalElements: total,
        totalPages: Math.ceil(total / p.size),
      },
    };
  }
  private async stats(c: PoolClient, r: ReadRequest) {
    const zone = await resolveVocabularyZone(c, r.headers['x-timezone']),
      today = (
        await c.query('SELECT (now() AT TIME ZONE $1)::date::text AS day', [
          zone,
        ])
      ).rows[0].day,
      day = (s: string, n: number) =>
        new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000)
          .toISOString()
          .slice(0, 10),
      first = day(today, -29);
    const rows = (
      await c.query(
        `SELECT t.*, (t.submitted_at AT TIME ZONE $2)::date::text AS day,a.title,a.exam_type,a.type,a.access_mode,a.release_policy,a.results_release_at,a.results_released_at,a.available_until,z.total_grade,z.max_grade,z.total_time,z.id AS result_id FROM attempt t JOIN assessments a ON a.id=t.assessment_id AND a.deleted_at IS NULL LEFT JOIN results z ON z.attempt_id=t.id WHERE t.student_id=$1 AND t.status='SUBMITTED' AND t.submitted_at IS NOT NULL ORDER BY t.submitted_at`,
        [r.user.id, zone],
      )
    ).rows;
    const perDay = Array(30).fill(0),
      days = new Set<string>();
    let studiedSeconds = 0,
      earned = 0n,
      possible = 0n;
    const scored = rows.filter(
      (t) =>
        this.released(t, new Date()) && t.result_id && Number(t.max_grade) > 0,
    );
    for (const t of rows) {
      days.add(t.day);
      if (t.day < first || t.day > today) continue;
      perDay[Math.round((Date.parse(t.day) - Date.parse(first)) / 86400000)]++;
      studiedSeconds += t.result_id
        ? t.total_time
        : Math.max(
            0,
            Math.floor(
              (new Date(t.submitted_at).getTime() -
                new Date(t.started_at).getTime()) /
                1000,
            ),
          );
    }
    for (const t of scored)
      if (t.day >= first && t.day <= today) {
        earned += cents(t.total_grade);
        possible += cents(t.max_grade);
      }
    const publicTests = scored
      .filter((t) => t.type === 'TEST' && t.access_mode === 'OPEN')
      .slice(-10);
    let best: Row | null = null;
    const ratio = (t: Row) =>
      rounded(cents(t.total_grade), cents(t.max_grade), 6);
    for (const t of publicTests)
      if (best === null || ratio(t) >= ratio(best)) best = t;
    let bestScore = null;
    if (best) {
      const previous = scored
        .slice(0, scored.indexOf(best))
        .filter((t) => t.assessment_id === best!.assessment_id)
        .at(-1);
      bestScore = {
        attemptId: best.id,
        assessmentId: best.assessment_id,
        title: best.title,
        examType: best.exam_type,
        totalGrade: Number(best.total_grade ?? 0),
        maxGrade: Number(best.max_grade),
        previousTotalGrade: previous ? Number(previous.total_grade ?? 0) : null,
        submittedAt: iso(best.submitted_at),
      };
    }
    let cursor = days.has(today) ? today : day(today, -1),
      current = 0,
      longest = 0,
      run = 0,
      previous = '';
    while (days.has(cursor)) {
      current++;
      cursor = day(cursor, -1);
    }
    for (const d of [...days].sort()) {
      run = previous && day(previous, 1) === d ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = d;
    }
    return {
      testsLast30Days: perDay.reduce((n, x) => n + x, 0),
      testsPerDay: perDay,
      bestScore,
      currentStreakDays: current,
      longestStreakDays: Math.max(longest, current),
      studiedSeconds,
      accuracy:
        possible > 0n ? Number(rounded(earned, possible, 4)) / 10000 : null,
    };
  }
}
