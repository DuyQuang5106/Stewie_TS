import { Injectable, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';
import { apiError } from '../read-api/auth.guard.js';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { academicUuid } from '../read-api/academic.service.js';
import { parsePaging, parseSort } from '../read-api/paging.js';
import {
  javaTrim,
  javaIsBlank,
  object,
  unreadable,
} from '../academic-write/question.binding.js';
type Row = Record<string, any>;
const blank = javaIsBlank;
const instant = (v: any) =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);
export function vocabularyZone(raw?: string) {
  const value = raw?.trim();
  if (!value) return 'Asia/Ho_Chi_Minh';
  if (['Z', 'UT'].includes(value)) return 'UTC';
  const offset =
    /^(?:(?:UTC|GMT|UT))?([+-])(\d{1,2})(?::?(\d{2}))?(?::?(\d{2}))?$/.exec(
      value,
    );
  if (offset) {
    const hours = Number(offset[2]),
      minutes = Number(offset[3] ?? 0),
      seconds = Number(offset[4] ?? 0);
    if (
      hours > 18 ||
      minutes > 59 ||
      seconds > 59 ||
      (hours === 18 && (minutes !== 0 || seconds !== 0))
    )
      return 'Asia/Ho_Chi_Minh';
    return `UTC${offset[1] === '+' ? '-' : '+'}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return 'Asia/Ho_Chi_Minh';
  }
}
export async function resolveVocabularyZone(client: PoolClient, raw?: string) {
  const zone = vocabularyZone(raw);
  if (/^UTC[+-]/.test(zone)) return zone;
  const found = (
    await client.query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [zone])
  ).rowCount;
  return found ? zone : 'Asia/Ho_Chi_Minh';
}

@Injectable()
export class VocabularyService {
  constructor(private readonly db: DatabaseService) {}
  private async clock(c: PoolClient, r: ReadRequest) {
    const zone = await resolveVocabularyZone(c, r.headers['x-timezone']);
    const now = new Date();
    return (
      await c.query(
        `SELECT $2::text AS zone,($1::timestamptz AT TIME ZONE $2)::date::text AS today,
    ((($1::timestamptz AT TIME ZONE $2)::date+1)::timestamp AT TIME ZONE $2) AS cutoff`,
        [now, zone],
      )
    ).rows[0];
  }
  private async playlist(c: PoolClient, id: string, r: ReadRequest) {
    const row = (
      await c.query(
        'SELECT * FROM vocab_playlists WHERE id=$1 AND owner_id=$2',
        [id, r.user.id],
      )
    ).rows[0];
    if (!row)
      throw apiError(404, `Không tìm thấy playlist với id: ${id}`, r.path);
    return row;
  }
  private async playlists(
    c: PoolClient,
    r: ReadRequest,
    clock: Row,
    id?: string,
  ) {
    const rows = (
      await c.query(
        `SELECT p.id,p.name,p.created_at AS "createdAt",
    count(w.id)::int AS words,count(w.id) FILTER(WHERE w.box IS NULL)::int AS learned,
    count(w.id) FILTER(WHERE w.box IS NOT NULL AND w.next_review_at<$2)::int AS due,
    ARRAY[count(w.id) FILTER(WHERE w.box=1),count(w.id) FILTER(WHERE w.box=2),count(w.id) FILTER(WHERE w.box=3),count(w.id) FILTER(WHERE w.box=4)] AS "boxSpread",
    min(w.next_review_at) AS "nextReviewAt",(SELECT max(r.reviewed_at) FROM vocab_reviews r JOIN vocab_words x ON x.id=r.word_id WHERE r.owner_id=$1 AND x.playlist_id=p.id) AS "lastReviewedAt"
    FROM vocab_playlists p LEFT JOIN vocab_words w ON w.playlist_id=p.id AND w.owner_id=$1
    WHERE p.owner_id=$1 AND ($3::uuid IS NULL OR p.id=$3) GROUP BY p.id ORDER BY p.created_at ASC`,
        [r.user.id, clock.cutoff, id ?? null],
      )
    ).rows;
    return rows.map((row) => ({
      ...row,
      boxSpread: row.boxSpread.map(Number),
      createdAt: instant(row.createdAt),
      nextReviewAt: instant(row.nextReviewAt),
      lastReviewedAt: instant(row.lastReviewedAt),
    }));
  }
  private async word(c: PoolClient, id: string, clock: Row) {
    return (
      await c.query(
        `SELECT id,playlist_id AS "playlistId",term,meaning,example,box,
  CASE WHEN next_review_at IS NULL THEN NULL ELSE greatest(0,(next_review_at AT TIME ZONE $2)::date-$3::date) END AS "dueInDays",seen_count AS "seenCount" FROM vocab_words WHERE id=$1`,
        [id, clock.zone, clock.today],
      )
    ).rows[0];
  }
  async read(
    action: string,
    r: ReadRequest,
    rawId?: string,
    query: Record<string, unknown> = {},
  ) {
    const id = rawId === undefined ? undefined : academicUuid(rawId, r);
    return this.db.readSnapshot(async (c) => {
      const clock = await this.clock(c, r);
      if (action === 'playlist') {
        await this.playlist(c, id!, r);
        return (await this.playlists(c, r, clock, id))[0];
      }
      if (action === 'playlists') return this.playlists(c, r, clock);
      if (action === 'due') {
        const rows = (
          await c.query(
            'SELECT box,count(*)::int AS n FROM vocab_words WHERE owner_id=$1 AND box IS NOT NULL AND next_review_at<$2 GROUP BY box',
            [r.user.id, clock.cutoff],
          )
        ).rows;
        const boxes = [1, 2, 3, 4].map((box) => ({
          box,
          words: rows.find((x) => x.box === box)?.n ?? 0,
        }));
        const lists = await this.playlists(c, r, clock);
        return {
          totalDue: boxes.reduce((n, b) => n + b.words, 0),
          boxes,
          sources: lists
            .filter((p) => p.due > 0)
            .sort((a, b) => b.due - a.due)
            .map((p) => ({ id: p.id, name: p.name, due: p.due })),
        };
      }
      if (action === 'streak') {
        const days = (
          await c.query(
            'SELECT DISTINCT (reviewed_at AT TIME ZONE $2)::date::text AS day FROM vocab_reviews WHERE owner_id=$1 ORDER BY day',
            [r.user.id, clock.zone],
          )
        ).rows.map((x) => x.day);
        const values = new Set(days);
        const day = (s: string, n: number) =>
          new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000)
            .toISOString()
            .slice(0, 10);
        let cursor = values.has(clock.today)
            ? clock.today
            : day(clock.today, -1),
          currentDays = 0,
          longestDays = 0,
          run = 0,
          previous = '';
        while (values.has(cursor)) {
          currentDays++;
          cursor = day(cursor, -1);
        }
        for (const d of days) {
          run = previous && day(previous, 1) === d ? run + 1 : 1;
          longestDays = Math.max(run, longestDays);
          previous = d;
        }
        const counts = (
          await c.query(
            'SELECT count(*)::int AS "wordsSaved",count(*) FILTER(WHERE box IS NULL)::int AS "wordsLearned" FROM vocab_words WHERE owner_id=$1',
            [r.user.id],
          )
        ).rows[0];
        return {
          currentDays,
          longestDays: Math.max(currentDays, longestDays),
          ...counts,
        };
      }
      const sort =
        parseSort(
          query,
          {
            id: 'id',
            term: 'term',
            box: 'box',
            nextReviewAt: 'next_review_at',
            seenCount: 'seen_count',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
          },
          r.path,
          ['term'],
        ) || 'ORDER BY created_at DESC';
      const filters: string[] = ['owner_id=$1', 'playlist_id=$2'];
      const params: unknown[] = [r.user.id, id];
      const bindingError = (
        key: string,
        type: string,
        reason: string,
      ): never => {
        throw new HttpException(
          {
            ...(apiError(
              400,
              'Dữ liệu đầu vào không hợp lệ',
              r.path,
            ).getResponse() as object),
            fieldErrors: {
              [key]: `Failed to convert value of type 'java.lang.String' to required type 'java.lang.${type}'; ${reason}`,
            },
          },
          400,
        );
      };
      const bool = (key: string) => {
        if (query[key] === undefined || query[key] === '') return null;
        const v = String(query[key]).toLowerCase();
        if (['true', 'on', 'yes', '1'].includes(v)) return true;
        if (['false', 'off', 'no', '0'].includes(v)) return false;
        bindingError(key, 'Boolean', `Invalid boolean value [${query[key]}]`);
      };
      if (bool('due')) {
        params.push(clock.cutoff);
        filters.push('box IS NOT NULL AND next_review_at<$' + params.length);
      }
      if (bool('learned')) filters.push('box IS NULL');
      if (query.maxBox !== undefined && query.maxBox !== '') {
        if (
          !/^[+-]?\d+$/.test(String(query.maxBox)) ||
          !Number.isInteger(Number(query.maxBox)) ||
          Number(query.maxBox) < -2147483648 ||
          Number(query.maxBox) > 2147483647
        )
          bindingError(
            'maxBox',
            'Integer',
            `For input string: "${query.maxBox}"`,
          );
        params.push(Number(query.maxBox));
        filters.push('box IS NOT NULL AND box<=$' + params.length);
      }
      if (query.q !== undefined && String(query.q).trim()) {
        params.push(
          '%' +
            javaTrim(String(query.q))
              .toLowerCase()
              .replace(/[\\%_]/g, '\\$&') +
            '%',
        );
        filters.push(
          `(lower(term) LIKE $${params.length} ESCAPE '\\' OR lower(meaning) LIKE $${params.length} ESCAPE '\\')`,
        );
      }
      await this.playlist(c, id!, r);
      const paging = parsePaging(query, 50);
      const where = filters.join(' AND ');
      const total = Number(
        (
          await c.query(
            'SELECT count(*) AS n FROM vocab_words WHERE ' + where,
            params,
          )
        ).rows[0].n,
      );
      params.push(paging.size, paging.page * paging.size);
      const rows = (
        await c.query(
          `SELECT id FROM vocab_words WHERE ${where} ${sort} LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        )
      ).rows;
      const content = [];
      for (const row of rows) content.push(await this.word(c, row.id, clock));
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
  private body(action: string, input: unknown, r: ReadRequest) {
    const raw = object(input);
    const errors: Record<string, string> = {};
    const out: Row = {};
    if (action === 'review') {
      const v = raw.knewIt;
      if (v === undefined || v === null || v === '')
        errors.knewIt = 'must not be null';
      else if (typeof v === 'boolean') out.knewIt = v;
      else if (typeof v === 'number' && Number.isInteger(v))
        out.knewIt = v !== 0;
      else if (
        typeof v === 'string' &&
        ['true', 'false', 'True', 'False', 'TRUE', 'FALSE'].includes(v.trim())
      )
        out.knewIt = v.trim().toLowerCase() === 'true';
      else throw unreadable();
    } else
      for (const [key, max, message, required] of action === 'playlist'
        ? [['name', 120, 'Tên playlist không được để trống', true]]
        : [
            ['term', 200, 'Từ không được để trống', true],
            ['meaning', 2000, 'Nghĩa không được để trống', true],
            ['example', 2000, '', false],
          ]) {
        const value = raw[String(key)];
        if (value !== undefined && value !== null && typeof value === 'object')
          throw unreadable();
        const v = value === undefined || value === null ? null : String(value);
        if (required && (v === null || !javaTrim(v)))
          errors[String(key)] = String(message);
        else if (v !== null && v.length > Number(max))
          errors[String(key)] = `size must be between 0 and ${max}`;
        out[String(key)] = v === null ? null : javaTrim(v);
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
  async write(action: string, r: ReadRequest, rawId?: string, input?: unknown) {
    const id = rawId === undefined ? undefined : academicUuid(rawId, r);
    const body = action === 'undo' ? null : this.body(action, input, r);
    try {
      return await this.db.writeTransaction(async (c) => {
        const clock = await this.clock(c, r);
        const now = new Date();
        if (action === 'playlist') {
          const duplicate = (
            await c.query(
              'SELECT id FROM vocab_playlists WHERE owner_id=$1 AND lower(name)=lower($2)',
              [r.user.id, body!.name],
            )
          ).rowCount;
          if (duplicate)
            throw apiError(
              409,
              `Bạn đã có playlist tên "${body!.name}"`,
              r.path,
            );
          const generated = randomUUID();
          await c.query(
            'INSERT INTO vocab_playlists(id,owner_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
            [generated, r.user.id, body!.name, now],
          );
          return (await this.playlists(c, r, clock, generated))[0];
        }
        if (action === 'word') {
          const playlist = await this.playlist(c, id!, r);
          if (
            (
              await c.query(
                'SELECT id FROM vocab_words WHERE playlist_id=$1 AND lower(term)=lower($2)',
                [id, body!.term],
              )
            ).rowCount
          )
            throw apiError(
              409,
              `"${body!.term}" đã có trong playlist ${playlist.name}`,
              r.path,
            );
          const generated = randomUUID();
          await c.query(
            `INSERT INTO vocab_words(id,playlist_id,owner_id,term,meaning,example,box,next_review_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,1,($7::date+1)::timestamp AT TIME ZONE $8,$9,$9)`,
            [
              generated,
              id,
              r.user.id,
              body!.term,
              body!.meaning,
              body!.example && !blank(body!.example) ? body!.example : null,
              clock.today,
              clock.zone,
              now,
            ],
          );
          return this.word(c, generated, clock);
        }
        let review: Row | undefined;
        if (action === 'undo') {
          review = (
            await c.query(
              'SELECT *,from_next_review_at::text AS from_next_review_at FROM vocab_reviews WHERE id=$1 AND owner_id=$2',
              [id, r.user.id],
            )
          ).rows[0];
          if (!review)
            throw apiError(404, `Không tìm thấy lượt ôn với id: ${id}`, r.path);
        }
        const wordId = review?.word_id ?? id;
        const word = (
          await c.query(
            'SELECT *,next_review_at::text AS next_review_at FROM vocab_words WHERE id=$1 AND owner_id=$2',
            [wordId, r.user.id],
          )
        ).rows[0];
        if (!word)
          throw apiError(404, `Không tìm thấy từ với id: ${wordId}`, r.path);
        let box: number | null, next: unknown, seen: number;
        if (review) {
          const latest = (
            await c.query(
              'SELECT id FROM vocab_reviews WHERE word_id=$1 ORDER BY reviewed_at DESC LIMIT 1',
              [wordId],
            )
          ).rows[0]?.id;
          if (latest !== id)
            throw apiError(
              409,
              'Chỉ có thể hoàn tác lượt ôn gần nhất của từ này',
              r.path,
            );
          box = review.from_box;
          next = review.from_next_review_at;
          seen = Math.max(0, word.seen_count - 1);
          await c.query('DELETE FROM vocab_reviews WHERE id=$1', [id]);
        } else {
          box = !body!.knewIt
            ? 1
            : word.box === null || word.box >= 4
              ? null
              : word.box + 1;
          next =
            box === null
              ? null
              : (
                  await c.query(
                    'SELECT ($1::date+$2::int)::timestamp AT TIME ZONE $3 AS next',
                    [clock.today, [1, 3, 7, 14][box - 1], clock.zone],
                  )
                ).rows[0].next;
          seen = word.seen_count + 1;
          review = { id: randomUUID() };
          await c.query(
            'INSERT INTO vocab_reviews(id,word_id,owner_id,knew_it,from_box,from_next_review_at,to_box,reviewed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              review.id,
              wordId,
              r.user.id,
              body!.knewIt,
              word.box,
              word.next_review_at,
              box,
              now,
            ],
          );
        }
        const updated = await c.query(
          'UPDATE vocab_words SET box=$2,next_review_at=$3,seen_count=$4,version=version+1,updated_at=$5 WHERE id=$1 AND version=$6',
          [wordId, box, next, seen, now, word.version],
        );
        if (!updated.rowCount)
          throw apiError(
            409,
            'Dữ liệu đã được cập nhật bởi yêu cầu khác; hãy tải lại trước khi thử lại',
            r.path,
          );
        const result = await this.word(c, wordId, clock);
        return action === 'undo'
          ? result
          : { reviewId: review!.id, word: result };
      }, 'vocabulary');
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith('23'))
        throw apiError(409, 'Dữ liệu bị trùng hoặc đang được sử dụng', r.path);
      throw error;
    }
  }
  async lookup(r: ReadRequest, term: unknown) {
    if (term === undefined)
      throw apiError(400, "Required parameter 'term' is not present.", r.path);
    const cleaned = javaTrim(String(term));
    if (!cleaned || cleaned.length > 200)
      throw apiError(400, 'Từ cần tra không hợp lệ', r.path);
    try {
      const base =
        process.env.DICTIONARY_BASE_URL ??
        'https://api.dictionaryapi.dev/api/v2/entries/en';
      const response = await fetch(
        base.replace(/\/$/, '') +
          '/' +
          encodeURIComponent(cleaned.toLowerCase()),
        { signal: AbortSignal.timeout(7000) },
      );
      if (response.status === 404)
        throw apiError(
          404,
          `Không tìm thấy từ trong từ điển: ${cleaned}`,
          r.path,
        );
      if (!response.ok) throw new Error('Dictionary unavailable');
      const entries = await response.json();
      for (const entry of Array.isArray(entries) ? entries : [])
        for (const meaning of entry.meanings ?? []) {
          let definition: string | null = null,
            example: string | null = null;
          for (const sense of meaning.definitions ?? []) {
            const text = javaTrim(String(sense.definition ?? ''));
            const sample = javaTrim(String(sense.example ?? ''));
            if (definition === null && text) definition = text;
            if (example === null && sample) example = sample;
            if (definition && example) break;
          }
          if (definition)
            return {
              term: entry.word ?? cleaned.toLowerCase(),
              definition,
              example,
            };
        }
      throw apiError(
        404,
        `Không tìm thấy từ trong từ điển: ${cleaned}`,
        r.path,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw apiError(503, 'Từ điển tạm thời không phản hồi', r.path);
    }
  }
}
