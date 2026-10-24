import { apiError } from '../read-api/auth.guard.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { academicUuid } from '../read-api/academic.service.js';
import { javaIsBlank, javaTrim } from '../academic-write/question.binding.js';
export type AnalyticsQuery = {
  type: string | null;
  status: string | null;
  groupBy: string | null;
  assessmentId: string | null;
  from: string | null;
  to: string | null;
  allTime: boolean;
  page: number;
  size: number;
  timeZone: string;
};
const missing = (key: string, r: ReadRequest): never => {
  throw apiError(400, `Required parameter '${key}' is not present.`, r.path);
};
export function analyticsQuery(
  action: string,
  q: Record<string, unknown>,
  r: ReadRequest,
): AnalyticsQuery {
  const mismatch = (key: string): never => {
    throw apiError(400, `Tham số '${key}' không đúng định dạng`, r.path);
  };
  const enumeration = (
    key: string,
    values: string[],
    required = false,
    ignoreCase = false,
  ) => {
    if (q[key] === undefined || q[key] === '') {
      if (required) return missing(key, r);
      return null;
    }
    let value = javaTrim(String(q[key]));
    if (ignoreCase) {
      if (javaIsBlank(value)) return missing(key, r);
      value = value.toUpperCase();
    }
    if (!values.includes(value)) return mismatch(key);
    return value;
  };
  const integer = (key: string, fallback: number) => {
    if (q[key] === undefined || q[key] === '') return fallback;
    const value = String(q[key]).trim();
    if (!/^[+-]?\d+$/.test(value)) return mismatch(key);
    const n = Number(value);
    if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647)
      return mismatch(key);
    return n;
  };
  const boolean = (key: string, fallback: boolean) => {
    if (q[key] === undefined || q[key] === '') return fallback;
    const v = String(q[key]).trim().toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(v)) return true;
    if (['false', 'off', 'no', '0'].includes(v)) return false;
    return mismatch(key);
  };
  const instant = (key: string) => {
    if (q[key] === undefined || q[key] === '') return null;
    const value = String(q[key]).trim();
    const match =
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.exec(
        value,
      );
    if (!match || Number.isNaN(Date.parse(value))) return mismatch(key);
    const fraction = match[1]?.slice(1).replace(/0+$/, '');
    return (
      new Date(value).toISOString().slice(0, 19) +
      (fraction ? '.' + fraction : '') +
      'Z'
    );
  };
  const result: AnalyticsQuery = {
    type: null,
    status: null,
    groupBy: null,
    assessmentId: null,
    from: null,
    to: null,
    allTime: false,
    page: 0,
    size: 20,
    timeZone: 'Asia/Ho_Chi_Minh',
  };
  if (action === 'assessment-history') {
    result.page = integer('page', 0);
    result.size = integer('size', 20);
  }
  if (action === 'performance')
    result.groupBy = enumeration(
      'groupBy',
      ['TOPIC', 'SKILL', 'DIFFICULTY'],
      true,
      true,
    );
  if (!['recap', 'next-practice'].includes(action))
    result.type = enumeration(
      'type',
      ['TEST', 'DRILL', 'HOMEWORK'],
      action === 'summary',
    );
  if (action === 'assessment-history')
    result.status = enumeration('status', ['STARTED', 'SUBMITTED']);
  if (
    action === 'score-trend' &&
    q.assessmentId !== undefined &&
    q.assessmentId !== ''
  )
    result.assessmentId = academicUuid(
      String(q.assessmentId),
      r,
      'assessmentId',
    );
  if (action === 'recap')
    result.timeZone =
      q.timeZone === undefined || q.timeZone === ''
        ? 'Asia/Ho_Chi_Minh'
        : String(q.timeZone);
  result.from = instant('from');
  result.to = instant('to');
  if (!['assessment-history', 'recap'].includes(action))
    result.allTime = boolean('allTime', action === 'next-practice');
  return result;
}
