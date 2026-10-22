import { HttpException } from '@nestjs/common';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { apiError } from '../read-api/auth.guard.js';
import {
  bodyUuid,
  enumValue,
  object,
  questionBody,
  unreadable,
} from './question.binding.js';
import type { JsonRecord } from './question.binding.js';
function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') throw unreadable();
  return String(value);
}
function validation(errors: Record<string, string>, request: ReadRequest) {
  if (Object.keys(errors).length)
    throw new HttpException(
      {
        ...(apiError(
          400,
          'Dữ liệu đầu vào không hợp lệ',
          request.path,
        ).getResponse() as object),
        fieldErrors: errors,
      },
      400,
    );
}
export function reviewBody(input: unknown, request: ReadRequest) {
  if (request.headers['content-length'] === '0') throw unreadable();
  const raw = object(input);
  const errors: Record<string, string> = {};
  const status = enumValue(raw.status, [
    'PENDING',
    'APPROVED',
    'CHANGES_REQUESTED',
  ]);
  const comment = scalar(raw.comment);
  if (status === null) errors.status = 'must not be null';
  if (comment !== null && comment.length > 2000)
    errors.comment = 'size must be between 0 and 2000';
  validation(errors, request);
  return { status, comment };
}
export function importBody(input: unknown, request: ReadRequest): JsonRecord {
  if (request.headers['content-length'] === '0') throw unreadable();
  const raw = object(input);
  const errors: Record<string, string> = {};
  let schemaVersion: number | null = null;
  if (raw.schemaVersion !== null && raw.schemaVersion !== undefined) {
    if (
      typeof raw.schemaVersion !== 'number' &&
      typeof raw.schemaVersion !== 'string'
    )
      throw unreadable();
    if (
      typeof raw.schemaVersion === 'string' &&
      raw.schemaVersion.trim() &&
      !/^[+-]?\d+$/.test(raw.schemaVersion.trim())
    )
      throw unreadable();
    const n = Number(raw.schemaVersion);
    if (!Number.isFinite(n) || n < -2147483648 || n > 2147483647)
      throw unreadable();
    schemaVersion =
      typeof raw.schemaVersion === 'string' && !raw.schemaVersion.trim()
        ? null
        : Math.trunc(n);
  }
  const importKey = scalar(raw.importKey);
  const targetQuestionBankId = bodyUuid(raw.targetQuestionBankId);
  if (schemaVersion === null) errors.schemaVersion = 'must not be null';
  if (importKey === null || !importKey.trim())
    errors.importKey = 'must not be blank';
  else if (importKey.length > 100)
    errors.importKey = 'size must be between 0 and 100';
  if (!targetQuestionBankId) errors.targetQuestionBankId = 'must not be null';
  let questions: (JsonRecord | null)[] | null = null;
  if (raw.questions === null || raw.questions === undefined)
    errors.questions = 'must not be null';
  else {
    if (!Array.isArray(raw.questions)) throw unreadable();
    if (raw.questions.length < 1 || raw.questions.length > 100)
      errors.questions = 'size must be between 1 and 100';
    questions = raw.questions.map((value: unknown, index: number) => {
      if (value === null) return null;
      const item = object(value);
      let parsed: JsonRecord = {};
      try {
        parsed = questionBody('update', item, request);
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const fieldErrors = (
          error.getResponse() as { fieldErrors: Record<string, string> }
        ).fieldErrors;
        for (const [key, message] of Object.entries(fieldErrors))
          errors[`questions[${index}].${key}`] = message;
      }
      const externalId = scalar(item.externalId);
      if (externalId === null || !externalId.trim())
        errors[`questions[${index}].externalId`] = 'must not be blank';
      else if (externalId.length > 100)
        errors[`questions[${index}].externalId`] =
          'size must be between 0 and 100';
      return {
        externalId,
        stimulusId: parsed.stimulusId,
        questionType: parsed.questionType,
        difficulty: parsed.difficulty,
        content: parsed.content,
        answer: parsed.answer,
        explanation: parsed.explanation,
        topicIds:
          item.topicIds === null || item.topicIds === undefined
            ? null
            : parsed.topicIds,
        skillIds:
          item.skillIds === null || item.skillIds === undefined
            ? null
            : parsed.skillIds,
        tagIds:
          item.tagIds === null || item.tagIds === undefined
            ? null
            : parsed.tagIds,
      };
    });
  }
  validation(errors, request);
  return { schemaVersion, importKey, targetQuestionBankId, questions };
}
