import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';
import { apiError } from '../read-api/auth.guard.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import {
  javaIsBlank,
  javaTrim,
  bodyUuid,
} from '../academic-write/question.binding.js';
import { vocabularyZone } from '../vocabulary/vocabulary.service.js';
import { analyticsQuery } from './analytics.binding.js';
import type { AnalyticsQuery } from './analytics.binding.js';
import {
  cents,
  percentage,
  rate,
  meanPercentage,
} from './analytics.decimal.js';
type Row = Record<string, any>;
type Window = { from: string | null; to: string | null; allTime: boolean };
const iso = (value: any) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value))
    return value;
  return new Date(value).toISOString();
};
const instantNanos = (value: string) => {
  const fraction = /\.(\d+)Z$/.exec(value)?.[1] ?? '';
  return (
    BigInt(Date.parse(value.replace(/\.\d+Z$/, 'Z'))) * 1000000n +
    BigInt(fraction.padEnd(9, '0'))
  );
};
const nanosIso = (n: bigint) => {
  const seconds =
    n / 1000000000n - (n < 0n && n % 1000000000n !== 0n ? 1n : 0n);
  return (
    new Date(Number(seconds * 1000n)).toISOString().slice(0, 19) +
    '.' +
    String(n - seconds * 1000000000n).padStart(9, '0') +
    'Z'
  );
};
const types = ['TEST', 'DRILL', 'HOMEWORK'];
@Injectable()
export class StudentAnalyticsService {
  constructor(private readonly db: DatabaseService) {}
  private range(r: ReadRequest, from: string | null, to: string | null) {
    if ((from === null) !== (to === null))
      throw apiError(
        400,
        "Cả 'from' và 'to' đều phải được cung cấp, hoặc để trống cả hai",
        r.path,
      );
    if (from !== null && to !== null && instantNanos(from) >= instantNanos(to))
      throw apiError(400, "'from' phải đứng trước 'to'", r.path);
  }
  private rolling(r: ReadRequest, q: AnalyticsQuery, now: Date): Window {
    if (q.allTime) return { from: null, to: null, allTime: true };
    this.range(r, q.from, q.to);
    return {
      from: q.from ?? new Date(now.getTime() - 30 * 86400000).toISOString(),
      to: q.to ?? now.toISOString(),
      allTime: false,
    };
  }
  private released(a: Row, now: Date) {
    if (a.release_policy === 'IMMEDIATE') return true;
    if (a.release_policy === 'MANUAL') return a.results_released_at !== null;
    const at = a.results_release_at ?? a.available_until;
    return at !== null && Date.parse(at) <= now.getTime();
  }
  private eligible(rows: Row[], now: Date) {
    return rows.filter(
      (t) =>
        t.status === 'SUBMITTED' &&
        !t.pending &&
        this.released(t.assessment, now) &&
        t.result_id !== null &&
        t.total_grade !== null &&
        t.max_grade !== null &&
        cents(t.max_grade) > 0n,
    );
  }
  private async attempts(
    c: PoolClient,
    r: ReadRequest,
    q: AnalyticsQuery,
    w: Window,
    kind: 'started' | 'submitted' | 'history',
  ) {
    const params: unknown[] = [r.user.id],
      where = ['t.student_id=$1', 'a.deleted_at IS NULL'];
    const bind = (v: unknown) => {
      params.push(v);
      return '$' + params.length;
    };
    if (q.type !== null) where.push('a.type=' + bind(q.type));
    if (kind === 'submitted') where.push("t.status='SUBMITTED'");
    if (kind === 'history' && q.status !== null)
      where.push('t.status=' + bind(q.status));
    if (kind === 'submitted' && q.assessmentId !== null)
      where.push('a.id=' + bind(q.assessmentId));
    const time = kind === 'submitted' ? 't.submitted_at' : 't.started_at';
    if (!w.allTime) {
      where.push(time + '>=' + bind(w.from));
      where.push(time + '<' + bind(w.to));
    }
    let paging = '';
    if (kind === 'history') {
      params.push(q.size, q.page * q.size);
      paging = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }
    const sql = `SELECT t.*,to_char(t.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,to_char(t.submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS submitted_at,to_jsonb(a) AS assessment,z.id AS result_id,z.total_grade,z.max_grade,z.total_time,
   EXISTS(SELECT 1 FROM attempt_question x WHERE x.attempt_id=t.id AND x.grading_status IN ('PENDING_REVIEW','UNGRADED')) AS pending
   FROM attempt t JOIN assessments a ON a.id=t.assessment_id LEFT JOIN results z ON z.attempt_id=t.id WHERE ${where.join(' AND ')} ${kind === 'submitted' ? 'ORDER BY t.submitted_at ASC' : kind === 'history' ? 'ORDER BY t.started_at DESC' : ''}${paging}`;
    const rows = (await c.query(sql, params)).rows;
    if (kind !== 'history') return { rows, total: rows.length };
    if (!rows.length) return { rows, total: 0 };
    const countParams = params.slice(0, -2);
    const total = Number(
      (
        await c.query(
          `SELECT count(*) AS n FROM attempt t JOIN assessments a ON a.id=t.assessment_id WHERE ${where.join(' AND ')}`,
          countParams,
        )
      ).rows[0].n,
    );
    return { rows, total };
  }
  private async questions(c: PoolClient, attempts: Row[]) {
    if (!attempts.length) return [];
    return (
      await c.query(
        'SELECT t.*,q.points,q.section_id,q.module_id,v.snapshot FROM attempt_question t JOIN assessment_questions q ON q.id=t.assessment_question_id JOIN question_version v ON v.id=q.question_version_id WHERE t.attempt_id=ANY($1::uuid[])',
        [attempts.map((a) => a.id)],
      )
    ).rows;
  }
  private ids(snapshot: Row, key: string): string[] {
    if (!Array.isArray(snapshot?.[key])) return [];
    return [
      ...new Set<string>(
        snapshot[key].map((id: unknown) => {
          const parsed = bodyUuid(id);
          if (!parsed) throw new Error('Invalid snapshot classification');
          return parsed;
        }),
      ),
    ];
  }
  private async groups(c: PoolClient, questions: Row[], groupBy: string) {
    const map = new Map<string, Row>();
    let unclassified = 0;
    for (const q of questions) {
      let ids: string[];
      if (groupBy === 'DIFFICULTY') {
        const value = q.snapshot?.difficulty,
          text =
            value === null || value === undefined || typeof value === 'object'
              ? ''
              : String(value);
        ids = javaIsBlank(text) ? [] : [text];
      } else
        ids = this.ids(
          q.snapshot,
          groupBy === 'SKILL' ? 'skillIds' : 'topicIds',
        );
      if (!ids.length) {
        unclassified++;
        ids = ['UNCLASSIFIED'];
      }
      for (const id of ids) {
        if (!map.has(id))
          map.set(id, {
            groupId: id,
            groupName: id === 'UNCLASSIFIED' ? 'Unclassified' : id,
            fullyCorrectCount: 0,
            partiallyCorrectCount: 0,
            incorrectCount: 0,
            gradedCount: 0,
            earned: 0n,
            possible: 0n,
          });
        const g = map.get(id)!;
        g.gradedCount++;
        if (q.grading_status === 'CORRECT') g.fullyCorrectCount++;
        else if (q.grading_status === 'PARTIALLY_CORRECT')
          g.partiallyCorrectCount++;
        else g.incorrectCount++;
        g.earned += cents(q.points_earned);
        g.possible += cents(q.points);
      }
    }
    if (groupBy !== 'DIFFICULTY') {
      const ids = [...map.keys()].filter((k) => k !== 'UNCLASSIFIED');
      if (ids.length) {
        const table = groupBy === 'SKILL' ? 'skill' : 'topic';
        const names = new Map(
          (
            await c.query(
              `SELECT id,name FROM ${table} WHERE id=ANY($1::uuid[])`,
              [ids],
            )
          ).rows.map((row) => [row.id, row.name]),
        );
        for (const id of ids)
          map.get(id)!.groupName = names.get(id) ?? `Retired/Unknown (${id})`;
      }
    }
    const groups = [...map.values()].map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      fullyCorrectCount: g.fullyCorrectCount,
      partiallyCorrectCount: g.partiallyCorrectCount,
      incorrectCount: g.incorrectCount,
      gradedCount: g.gradedCount,
      pointsEarned: Number(g.earned) / 100,
      pointsPossible: Number(g.possible) / 100,
      fullyCorrectRate: rate(g.fullyCorrectCount, g.gradedCount),
      pointsPercentage: percentage(g.earned, g.possible),
      insufficientData: g.gradedCount < 5,
    }));
    groups.sort((a, b) =>
      a.groupName < b.groupName ? -1 : a.groupName > b.groupName ? 1 : 0,
    );
    return {
      groups,
      totalDistinctGradedQuestions: new Set(questions.map((q) => q.id)).size,
      totalUnclassifiedGradedQuestions: unclassified,
    };
  }
  private async zone(c: PoolClient, r: ReadRequest, raw: string) {
    const value = javaIsBlank(raw) ? 'Asia/Ho_Chi_Minh' : raw;
    const fail = (): never => {
      throw apiError(400, 'Múi giờ không hợp lệ: ' + raw, r.path);
    };
    if (value !== javaTrim(value)) return fail();
    const offset =
      /^(UTC|GMT|UT)?([+-])(\d{1,2})(?::?(\d{2}))?(?::?(\d{2}))?$/.exec(value);
    if (offset) {
      const h = Number(offset[3]),
        m = Number(offset[4] ?? 0),
        s = Number(offset[5] ?? 0);
      if (h > 18 || m > 59 || s > 59 || (h === 18 && (m || s))) return fail();
      const prefix = offset[1] ?? '',
        suffix =
          h === 0 && m === 0 && s === 0
            ? ''
            : `${offset[2]}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${s ? ':' + String(s).padStart(2, '0') : ''}`;
      return {
        sql: vocabularyZone(value),
        id: suffix ? prefix + suffix : prefix || 'Z',
      };
    }
    if (value === 'Z' || value === 'UT') return { sql: 'UTC', id: value };
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
    } catch {
      return fail();
    }
    if (
      !(await c.query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [value]))
        .rowCount
    )
      return fail();
    return { sql: value, id: value };
  }
  async read(action: string, r: ReadRequest, raw: Record<string, unknown>) {
    const q = analyticsQuery(action, raw, r);
    if (!r.user.roles.includes('STUDENT'))
      throw apiError(403, 'Bạn không có quyền thực hiện thao tác này', r.path);
    if (
      action === 'assessment-history' &&
      (q.page < 0 || q.size < 1 || q.size > 100)
    )
      throw apiError(
        400,
        'page must be non-negative and size must be between 1 and 100',
        r.path,
      );
    return this.db.readSnapshot(async (c) => {
      const now = new Date();
      if (action === 'assessment-history') {
        this.range(r, q.from, q.to);
        const w: Window = { from: q.from, to: q.to, allTime: q.from === null };
        const { rows, total } = await this.attempts(c, r, q, w, 'history');
        return {
          content: rows.map((t) => {
            const gradingState =
                t.status !== 'SUBMITTED'
                  ? 'IN_PROGRESS'
                  : t.pending
                    ? 'PENDING_GRADING'
                    : 'FINAL',
              releaseState = this.released(t.assessment, now)
                ? 'RELEASED'
                : 'UNRELEASED',
              scoreStatus =
                gradingState === 'FINAL' && releaseState === 'RELEASED'
                  ? 'FINAL'
                  : 'HIDDEN_UNTIL_FINAL',
              visible = scoreStatus === 'FINAL' && t.result_id !== null;
            return {
              attemptId: t.id,
              assessmentId: t.assessment_id,
              title: t.assessment.title,
              type: t.assessment.type,
              attemptNumber: t.attempt_number,
              status: t.status,
              startedAt: iso(t.started_at),
              submittedAt: iso(t.submitted_at),
              gradingState,
              releaseState,
              scoreStatus,
              score:
                visible && t.total_grade !== null
                  ? Number(t.total_grade)
                  : null,
              maxScore:
                visible && t.max_grade !== null ? Number(t.max_grade) : null,
            };
          }),
          page: {
            size: q.size,
            number: q.page,
            totalElements: total,
            totalPages: Math.ceil(total / q.size),
          },
        };
      }
      if (action === 'recap') return this.recap(c, r, q, now);
      if (
        action === 'score-trend' &&
        (q.type !== null) === (q.assessmentId !== null)
      )
        throw apiError(
          400,
          "Phải cung cấp chính xác một trong hai: 'type' hoặc 'assessmentId'",
          r.path,
        );
      const w = this.rolling(r, q, now),
        { rows: candidates } = await this.attempts(c, r, q, w, 'submitted'),
        eligible = this.eligible(candidates, now);
      if (action === 'summary') {
        const { rows: started } = await this.attempts(c, r, q, w, 'started');
        return {
          type: q.type,
          ...w,
          startedAttemptsCount: started.length,
          completedAttemptsCount: candidates.length,
          pendingGradingCount: candidates.filter((t) => t.pending).length,
          finalReleasedCount: eligible.length,
          meanPercentage: meanPercentage(eligible),
          includedAttemptsCount: eligible.length,
        };
      }
      if (action === 'score-trend')
        return {
          type: q.type,
          assessmentId: q.assessmentId,
          ...w,
          sampleCount: eligible.length,
          dataPoints: eligible.map((t) => ({
            attemptId: t.id,
            assessmentId: t.assessment_id,
            assessmentTitle: t.assessment.title,
            assessmentType: t.assessment.type,
            submittedAt: iso(t.submitted_at),
            normalizedPercentage: percentage(
              cents(t.total_grade),
              cents(t.max_grade),
            ),
            attemptNumber: t.attempt_number,
          })),
        };
      if (action === 'time-summary') {
        const stats = (rows: Row[]) => {
          const timed = rows.filter(
              (t) => t.result_id !== null && t.total_time > 0,
            ),
            time = timed.reduce((sum, t) => sum + BigInt(t.total_time), 0n);
          return {
            completedAttemptsCount: rows.length,
            attemptsWithTimeDataCount: timed.length,
            totalStudyTimeSeconds: Number(time),
            averageStudyTimeSeconds: timed.length
              ? Number(time / BigInt(timed.length))
              : null,
          };
        };
        return {
          ...w,
          ...stats(candidates),
          breakdowns:
            q.type !== null
              ? []
              : types.map((type) => ({
                  type,
                  ...stats(
                    candidates.filter((t) => t.assessment.type === type),
                  ),
                })),
        };
      }
      const questions = await this.questions(c, eligible);
      if (action === 'performance')
        return {
          groupBy: q.groupBy,
          type: q.type,
          ...w,
          ...(await this.groups(c, questions, q.groupBy!)),
        };
      return this.next(c, eligible, questions);
    });
  }
  private async recap(
    c: PoolClient,
    r: ReadRequest,
    q: AnalyticsQuery,
    now: Date,
  ) {
    const zone = await this.zone(c, r, q.timeZone);
    this.range(r, q.from, q.to);
    let from = q.from,
      to = q.to;
    if (from === null) {
      const dates = (
        await c.query(
          `SELECT (((($1::timestamptz AT TIME ZONE $2)::date-29)::timestamp) AT TIME ZONE $2) AS start,(((($1::timestamptz AT TIME ZONE $2)::date+1)::timestamp) AT TIME ZONE $2) AS finish`,
          [now, zone.sql],
        )
      ).rows[0];
      from = iso(dates.start);
      to = iso(dates.finish);
    }
    const w: Window = { from, to, allTime: false },
      duration = instantNanos(to!) - instantNanos(from!),
      previous: Window = {
        from: nanosIso(instantNanos(from!) - duration),
        to: from,
        allTime: false,
      };
    const { rows: started } = await this.attempts(c, r, q, w, 'started'),
      { rows: candidates } = await this.attempts(c, r, q, w, 'submitted'),
      eligible = this.eligible(candidates, now),
      { rows: old } = await this.attempts(c, r, q, previous, 'submitted'),
      previousEligible = this.eligible(old, now),
      questions = await this.questions(c, eligible);
    return {
      effectiveTimeZone: zone.id,
      periodStart: from,
      periodEnd: to,
      totalAttemptsStarted: started.length,
      totalAttemptsCompleted: candidates.length,
      distinctGradedQuestionsCount: new Set(questions.map((q) => q.id)).size,
      totalStudyTimeSeconds: candidates.reduce(
        (n, t) =>
          n + (t.result_id !== null && t.total_time > 0 ? t.total_time : 0),
        0,
      ),
      scoreChanges: types.map((type) => {
        const currentMeanPercentage = meanPercentage(
            eligible.filter((t) => t.assessment.type === type),
          ),
          previousMeanPercentage = meanPercentage(
            previousEligible.filter((t) => t.assessment.type === type),
          );
        return {
          type,
          previousMeanPercentage,
          currentMeanPercentage,
          changePercentagePoints:
            currentMeanPercentage === null || previousMeanPercentage === null
              ? null
              : Number(
                  cents(currentMeanPercentage) - cents(previousMeanPercentage),
                ) / 100,
        };
      }),
      hasActivity: started.length > 0 || candidates.length > 0,
    };
  }
  private async next(c: PoolClient, eligible: Row[], questions: Row[]) {
    const empty = (reason: string, rationaleMessage: string) => ({
      hasRecommendation: false,
      noRecommendationReason: reason,
      skillId: null,
      skillName: null,
      topicName: null,
      pointsPercentage: null,
      fullyCorrectRate: null,
      gradedCount: 0,
      pointsEarned: null,
      pointsPossible: null,
      availableQuestionCount: 0,
      canStartDrill: false,
      rationaleMessage,
    });
    if (!eligible.length)
      return empty(
        'NO_RELEASED_RESULTS',
        'Chưa có bài thi nào được chấm và công bố điểm để gợi ý luyện tập.',
      );
    const counts = new Map<string, Row>();
    for (const q of questions)
      for (const id of this.ids(q.snapshot, 'skillIds')) {
        if (!counts.has(id))
          counts.set(id, {
            id,
            count: 0,
            correct: 0,
            earned: 0n,
            possible: 0n,
          });
        const g = counts.get(id)!;
        g.count++;
        if (q.grading_status === 'CORRECT') g.correct++;
        g.earned += cents(q.points_earned);
        g.possible += cents(q.points);
      }
    const qualified = [...counts.values()].filter((g) => g.count >= 5);
    if (!qualified.length)
      return empty(
        'INSUFFICIENT_DATA',
        'Chưa có kỹ năng nào đạt tối thiểu 5 câu hỏi đã chấm để đưa ra gợi ý tin cậy.',
      );
    const ids = qualified.map((g) => g.id),
      names = new Map(
        (
          await c.query('SELECT id,name FROM skill WHERE id=ANY($1::uuid[])', [
            ids,
          ])
        ).rows.map((s) => [s.id, s.name]),
      ),
      available = new Map(
        (
          await c.query(
            "SELECT s.skill_id,count(*)::int AS count FROM question_skill s JOIN question q ON q.id=s.question_id AND q.deleted_at IS NULL WHERE s.skill_id=ANY($1::uuid[]) AND q.status='PUBLISHED' GROUP BY s.skill_id",
            [ids],
          )
        ).rows.map((row) => [row.skill_id, row.count]),
      );
    const choices = qualified
      .filter((g) => (available.get(g.id) ?? 0) > 0)
      .map((g): Row => ({
        ...g,
        name: names.get(g.id) ?? `Skill (${g.id})`,
        percentage: percentage(g.earned, g.possible),
      }));
    choices.sort(
      (a, b) =>
        a.percentage - b.percentage ||
        b.count - a.count ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const top = choices[0];
    if (!top)
      return empty(
        'NO_AVAILABLE_QUESTIONS',
        'Các kỹ năng cần cải thiện hiện chưa có câu hỏi luyện tập nào sẵn sàng trong Question Bank.',
      );
    return {
      hasRecommendation: true,
      noRecommendationReason: null,
      skillId: top.id,
      skillName: top.name,
      topicName: null,
      pointsPercentage: top.percentage,
      fullyCorrectRate: rate(top.correct, top.count),
      gradedCount: top.count,
      pointsEarned: Number(top.earned) / 100,
      pointsPossible: Number(top.possible) / 100,
      availableQuestionCount: available.get(top.id) ?? 0,
      canStartDrill: false,
      rationaleMessage: `Dựa trên ${top.count} câu hỏi đã chấm ở kỹ năng '${top.name}' với tỷ lệ đạt ${top.percentage.toFixed(2)}%, bạn nên luyện tập thêm kỹ năng này để cải thiện kết quả.`,
    };
  }
}
