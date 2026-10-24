import type { Response } from 'express';
import { readConfig } from '../config.js';
import { HttpException } from '@nestjs/common';
export const authError = (status: number, message: string, path: string) =>
  new HttpException(
    {
      timestamp: new Date().toISOString().replace(/Z$/, ''),
      status,
      error:
        status === 401
          ? 'Unauthorized'
          : status === 409
            ? 'Conflict'
            : 'Bad Request',
      message,
      path,
      fieldErrors: {},
    },
    status,
  );
export const cookieValue = (header: string | undefined, name: string) =>
  header
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + '='))
    ?.slice(name.length + 1);

export function authCookies(
  res: Response,
  tokens?: { accessToken: string; refreshToken: string },
) {
  const cfg = readConfig();
  for (const [name, value, age] of [
    ['token', tokens?.accessToken, Math.floor(cfg.authAccessMs / 1000)],
    [
      'refreshToken',
      tokens?.refreshToken,
      Math.floor(cfg.authRefreshMs / 1000),
    ],
  ] as const) {
    const ttl = tokens ? age : 0;
    res.append(
      'Set-Cookie',
      `${name}=${value ?? ''}; Path=/; Max-Age=${ttl}; Expires=${ttl ? new Date(Date.now() + ttl * 1000).toUTCString() : 'Thu, 01 Jan 1970 00:00:00 GMT'}${cfg.authCookieSecure ? '; Secure' : ''}; HttpOnly; SameSite=Lax`,
    );
  }
}
