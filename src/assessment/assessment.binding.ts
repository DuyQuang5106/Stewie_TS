import { HttpException } from '@nestjs/common';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { apiError } from '../read-api/auth.guard.js';
import {
  object,
  bodyUuid,
  enumValue,
  unreadable,
  javaTrim,
} from '../academic-write/question.binding.js';
export type Row = Record<string, any>;
export function assessmentBody(
  action: string,
  input: unknown,
  r: ReadRequest,
): Row {
  const raw = object(input),
    out: Row = {},
    errors: Record<string, string> = {};
  function string(key: string, max: number, required = false) {
    const value = raw[key];
    if (value !== null && value !== undefined && typeof value === 'object')
      throw unreadable();
    const v = value === null || value === undefined ? null : String(value);
    out[key] = v;
    if (required && (v === null || !javaTrim(v)))
      errors[key] = 'must not be blank';
    else if (v !== null && v.length > max)
      errors[key] = `size must be between 0 and ${max}`;
  }
  function integer(key: string, required = false) {
    const value = raw[key];
    let v = null;
    if (value !== undefined && value !== null && value !== '') {
      if (
        !['string', 'number'].includes(typeof value) ||
        (typeof value === 'string' && !/^[+-]?\d+$/.test(value.trim()))
      )
        throw unreadable();
      const n = Number(value);
      if (!Number.isFinite(n) || n < -2147483648 || n > 2147483647)
        throw unreadable();
      v = Math.trunc(n);
    }
    out[key] = v;
    if (required && v === null) errors[key] = 'must not be null';
    else if (v !== null && v < 1)
      errors[key] = 'must be greater than or equal to 1';
  }
  function enumeration(key: string, values: string[], required = false) {
    const v = enumValue(raw[key], values);
    out[key] = v;
    if (required && v === null) errors[key] = 'must not be null';
  }
  function instant(key: string) {
    const value = raw[key];
    if (value === null || value === undefined || value === '') {
      out[key] = null;
      return;
    }
    if (typeof value === 'number') {
      out[key] = new Date(value * 1000).toISOString();
      return;
    }
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
      Number.isNaN(Date.parse(value))
    )
      throw unreadable();
    out[key] = new Date(value).toISOString();
  }
  function uuid(key: string) {
    out[key] = bodyUuid(raw[key]);
    if (out[key] === null) errors[key] = 'must not be null';
  }
  function config() {
    const v = raw.config;
    if (
      v !== null &&
      v !== undefined &&
      (typeof v !== 'object' || Array.isArray(v))
    )
      throw unreadable();
    out.config = v ?? null;
  }
  if (action === 'create' || action === 'update') {
    string('title', 255, true);
    string('description', 1023);
    string('mode', 127);
    string('examType', 127);
    enumeration('type', ['TEST', 'DRILL', 'HOMEWORK'], true);
    enumeration(
      'releasePolicy',
      ['IMMEDIATE', 'MANUAL', 'AFTER_DEADLINE'],
      true,
    );
    enumeration('accessMode', ['OPEN', 'ASSIGNED_ONLY']);
    enumeration('timingMode', ['STRICT', 'SOFT']);
    instant('availableFrom');
    instant('availableUntil');
    instant('resultsReleaseAt');
    integer('maxAttempts');
    config();
  } else if (action === 'section' || action === 'module') {
    string('name', 255, true);
    string('code', 63);
    integer('orderIndex', true);
    integer('durationSeconds');
    config();
  } else if (action === 'question') {
    uuid('questionId');
    uuid('questionVersionId');
    integer('position', true);
    config();
    const v = raw.points;
    if (v === undefined || v === null || v === '') out.points = null;
    else {
      if (
        !['number', 'string'].includes(typeof v) ||
        !Number.isFinite(Number(v))
      )
        throw unreadable();
      out.points = String(v);
      if (Number(v) < 0.01)
        errors.points = 'must be greater than or equal to 0.01';
    }
  } else if (action === 'assign') {
    uuid('studentId');
    instant('dueAt');
  } else if (action === 'access-mode')
    enumeration('accessMode', ['OPEN', 'ASSIGNED_ONLY'], true);
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
