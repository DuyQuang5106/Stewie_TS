import { HttpException } from '@nestjs/common';
import { apiError } from '../read-api/auth.guard.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import {
  object,
  bodyUuid,
  unreadable,
} from '../academic-write/question.binding.js';
import type { Row } from './assessment.binding.js';
export function takingBody(
  action: string,
  input: unknown,
  r: ReadRequest,
): Row {
  if (r.jsonParseFailed) throw unreadable();
  if (action === 'start' && (input === undefined || input === null))
    return { timed: null };
  const raw = object(input),
    out: Row = {},
    errors: Record<string, string> = {};
  const boolean = (value: any, defaultValue: any) => {
    if (value === undefined || value === null || value === '')
      return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isInteger(value))
      return value !== 0;
    if (typeof value === 'string' && /^(true|false)$/i.test(value.trim()))
      return value.trim().toLowerCase() === 'true';
    throw unreadable();
  };
  if (action === 'start') return { timed: boolean(raw.timed, null) };
  if (action === 'question-time') {
    if (
      raw.entries === undefined ||
      raw.entries === null ||
      (Array.isArray(raw.entries) && !raw.entries.length)
    )
      errors.entries = 'must not be empty';
    if (
      raw.entries !== null &&
      raw.entries !== undefined &&
      !Array.isArray(raw.entries)
    )
      throw unreadable();
    if (raw.entries?.length > 200)
      errors.entries = 'size must be between 0 and 200';
    out.entries = (raw.entries ?? []).map((v: any, i: number) => {
      if (v === null) {
        errors[`entries[${i}]`] = 'must not be null';
        return null;
      }
      const row = object(v);
      const id = bodyUuid(row.assessmentQuestionId);
      if (!id)
        errors[`entries[${i}].assessmentQuestionId`] = 'must not be null';
      let seconds = 0;
      if (
        row.seconds !== null &&
        row.seconds !== undefined &&
        row.seconds !== ''
      ) {
        if (
          !['string', 'number'].includes(typeof row.seconds) ||
          (typeof row.seconds === 'string' &&
            !/^[+-]?\d+$/.test(row.seconds.trim())) ||
          !Number.isFinite(Number(row.seconds))
        )
          throw unreadable();
        seconds = Math.trunc(Number(row.seconds));
        if (seconds < -2147483648 || seconds > 2147483647) throw unreadable();
      }
      if (seconds < 0)
        errors[`entries[${i}].seconds`] = 'must be greater than or equal to 0';
      if (seconds > 86400)
        errors[`entries[${i}].seconds`] = 'must be less than or equal to 86400';
      return { assessmentQuestionId: id, seconds };
    });
  } else {
    out.assessmentQuestionId = bodyUuid(raw.assessmentQuestionId);
    if (!out.assessmentQuestionId)
      errors.assessmentQuestionId = 'must not be null';
    if (action === 'answers') out.answerData = raw.answerData ?? null;
    else out.isFlagged = boolean(raw.isFlagged, false);
  }
  if (Object.keys(errors).length)
    throw new HttpException(
      {
        ...(apiError(
          400,
          'Dữ liệu đầu vào không hợp lệ',
          r.path,
        ).getResponse() as object),
        fieldErrors: errors,
      },
      400,
    );
  return out;
}
