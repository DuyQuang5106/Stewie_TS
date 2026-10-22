import { HttpException } from '@nestjs/common';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { apiError } from '../read-api/auth.guard.js';

export type JsonRecord = Record<string, any>;
export const javaTrim = (value: string) => {
  let a = 0;
  let b = value.length;
  while (a < b && value.charCodeAt(a) <= 32) a++;
  while (b > a && value.charCodeAt(b - 1) <= 32) b--;
  return value.slice(a, b);
};
export const unreadable = () => new Error('Unreadable question request');
export function object(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw unreadable();
  return value as JsonRecord;
}
export function bodyUuid(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw unreadable();
  let s = value.trim();
  if (!s) return null;
  if (/^[A-Za-z0-9+/]{22}==$/.test(s)) {
    const h = Buffer.from(s, 'base64').toString('hex');
    s = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  )
    throw unreadable();
  return s.toLowerCase();
}
export function enumValue(value: unknown, choices: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isInteger(value) && choices[value])
    return choices[value]!;
  if (typeof value === 'string') {
    const text = value.trim();
    if (choices.includes(text)) return text;
    if (/^\d+$/.test(text) && choices[Number(text)])
      return choices[Number(text)]!;
  }
  throw unreadable();
}
export function questionBody(
  action: string,
  input: unknown,
  request: ReadRequest,
): JsonRecord {
  if (request.headers['content-length'] === '0') throw unreadable();
  const raw = object(input);
  const errors: Record<string, string> = {};
  const required = (key: string, value: unknown) => {
    if (value === null || value === undefined) errors[key] = 'must not be null';
    return value;
  };
  const string = (
    value: unknown,
    key: string,
    max: number,
    blank = false,
  ): string | null => {
    if (value !== null && value !== undefined && typeof value === 'object')
      throw unreadable();
    const text = value === null || value === undefined ? null : String(value);
    if (blank && (text === null || !text.trim()))
      errors[key] = 'must not be blank';
    else if (text !== null && text.length > max)
      errors[key] = `size must be between 0 and ${max}`;
    return text;
  };
  const list = (value: unknown): unknown[] | null => {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) throw unreadable();
    return value;
  };
  let result: JsonRecord;
  if (action === 'publish')
    result = {
      changeSummary: string(raw.changeSummary, 'changeSummary', 1000),
    };
  else if (action === 'duplicate' || action === 'transfer-ownership') {
    result = {
      targetQuestionBankId: required(
        'targetQuestionBankId',
        bodyUuid(raw.targetQuestionBankId),
      ),
    };
    if (action === 'transfer-ownership')
      result.reason = string(raw.reason, 'reason', 1000, true);
  } else {
    result = {
      stimulusId: bodyUuid(raw.stimulusId),
      questionType: required(
        'questionType',
        enumValue(raw.questionType, [
          'MULTIPLE_CHOICE',
          'FILL_IN',
          'SHORT_ANSWER',
          'ESSAY',
        ]),
      ),
      difficulty: required(
        'difficulty',
        enumValue(raw.difficulty, ['EASY', 'MEDIUM', 'HARD']),
      ),
    };
    if (action === 'create')
      result.questionBankId = required(
        'questionBankId',
        bodyUuid(raw.questionBankId),
      );
    for (const field of ['topicIds', 'skillIds', 'tagIds'])
      result[field] = [...new Set((list(raw[field]) ?? []).map(bodyUuid))];
    for (const key of ['content', 'answer', 'explanation']) {
      if (raw[key] === null || raw[key] === undefined) {
        required(key, null);
        result[key] = null;
        continue;
      }
      const source = object(raw[key]);
      if (key === 'content') {
        const options =
          list(source.options)?.map((value, i) => {
            if (value === null) return null;
            const option = object(value);
            return {
              id: string(option.id, `content.options[${i}].id`, 50, true),
              content: string(
                option.content,
                `content.options[${i}].content`,
                5000,
                true,
              ),
            };
          }) ?? null;
        result.content = {
          title: string(source.title, 'content.title', 255, true),
          prompt: string(source.prompt, 'content.prompt', 20000, true),
          options,
        };
      } else if (key === 'answer')
        result.answer = {
          correctOptionIds:
            source.correctOptionIds === null ||
            source.correctOptionIds === undefined
              ? null
              : [
                  ...new Set(
                    list(source.correctOptionIds)!.map((v) =>
                      string(v, `answer.correctOptionIds[]`, 50),
                    ),
                  ),
                ],
          acceptedAnswers:
            list(source.acceptedAnswers)?.map((v, i) =>
              string(v, `answer.acceptedAnswers[${i}]`, 1000),
            ) ?? null,
          gradingMode: enumValue(source.gradingMode, ['NUMERIC', 'TEXT_EXACT']),
          gradingGuide: string(
            source.gradingGuide,
            'answer.gradingGuide',
            10000,
          ),
        };
      else
        result.explanation = {
          text: string(source.text, 'explanation.text', 20000, true),
        };
    }
  }
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
  return result;
}

export function validateAggregate(
  type: string,
  content: JsonRecord,
  answer: JsonRecord,
  request: ReadRequest,
) {
  const fail = (message: string): never => {
    throw apiError(400, message, request.path);
  };
  const options = content.options ?? [];
  if (options.some((o: unknown) => o === null)) throw unreadable();
  const ids = new Set(options.map((o: JsonRecord) => o.id));
  if (ids.size !== options.length) fail('Option id không được trùng nhau');
  const correct = answer.correctOptionIds ?? [];
  const accepted = answer.acceptedAnswers ?? [];
  const guide = answer.gradingGuide;
  if (type === 'MULTIPLE_CHOICE') {
    if (options.length < 2) fail('MULTIPLE_CHOICE phải có ít nhất 2 options');
    if (!correct.length || correct.some((id: string) => !ids.has(id)))
      fail('correctOptionIds phải tham chiếu options hợp lệ');
    if (accepted.length) fail('MULTIPLE_CHOICE không dùng acceptedAnswers');
    if (guide?.trim()) fail('MULTIPLE_CHOICE không dùng gradingGuide');
  } else {
    if (options.length) fail(`${type} không dùng options`);
    if (type === 'ESSAY') {
      if (!guide?.trim()) fail('ESSAY phải có gradingGuide');
      if (correct.length) fail('ESSAY không dùng correctOptionIds');
      if (accepted.length) fail('ESSAY không dùng acceptedAnswers');
    } else {
      if (!accepted.some((v: string | null) => v !== null && v.trim()))
        fail(`${type} phải có ít nhất một acceptedAnswer`);
      if (correct.length) fail(`${type} không dùng correctOptionIds`);
      if (guide?.trim()) fail(`${type} không dùng gradingGuide`);
    }
  }
}
