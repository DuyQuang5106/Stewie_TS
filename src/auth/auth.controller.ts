import {
  Controller,
  Post,
  Get,
  Req,
  Res,
  Body,
  Query,
  UseGuards,
  UseFilters,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { readConfig } from '../config.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { authError, cookieValue, authCookies } from './auth.helpers.js';
import { javaIsBlank } from '../academic-write/question.binding.js';
import { ReadApiErrorFilter } from '../read-api/error.filter.js';
import { GoogleOAuthService } from './google-oauth.service.js';
function extract(body: unknown, r: Request) {
  if ((r as any).jsonParseFailed) throw new Error('Unreadable request');
  if (body !== undefined && body !== null) {
    if (typeof body !== 'object' || Array.isArray(body))
      throw new Error('Unreadable request');
    const v = (body as any).refreshToken;
    if (v !== undefined && v !== null) {
      if (typeof v === 'object') throw new Error('Unreadable request');
      const token = String(v);
      if (!javaIsBlank(token)) return token;
    }
  }
  return cookieValue(r.headers.cookie, 'refreshToken');
}
@Controller()
@UseGuards(AuthGuard)
@UseFilters(ReadApiErrorFilter)
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly google: GoogleOAuthService,
  ) {}
  @Post('api/auth/refresh') async refresh(
    @Req() r: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const token = extract(body, r);
    if (token === undefined)
      throw authError(
        400,
        'Refresh token is missing from request body and cookies',
        r.path,
      );
    if (javaIsBlank(token))
      throw authError(400, 'Refresh token cannot be blank', r.path);
    const tokens = await this.service.refresh(token, r.path);
    authCookies(res, tokens);
    res.status(200);
    return tokens;
  }
  @Post('api/auth/logout') async logout(
    @Req() r: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    await this.service.logout(extract(body, r));
    authCookies(res);
    res.status(204).send();
  }
  @Post('api/auth/dev-login') async dev(
    @Req() r: Request,
    @Res({ passthrough: true }) res: Response,
    @Query() q: Record<string, unknown>,
  ) {
    if (!readConfig().authDevLoginEnabled) throw new NotFoundException();
    const value = (key: string, fallback: string) =>
      q[key] === undefined || q[key] === '' ? fallback : String(q[key]);
    const role = value('role', 'ADMIN').trim();
    if (!['ADMIN', 'TEACHER', 'STUDENT'].includes(role))
      throw authError(400, "Tham số 'role' không đúng định dạng", r.path);
    const tokens = await this.service.devLogin(
      value('email', 'admin@stewiesat.com'),
      value('name', 'Admin User'),
      role,
      r.path,
    );
    authCookies(res, tokens);
    res.status(200);
    return tokens;
  }
  @Get('oauth2/authorization/google') start(@Res() res: Response) {
    if (!readConfig().googleOAuthEnabled) throw new NotFoundException();
    return this.google.start(res);
  }
  @Get('login/oauth2/code/google') finish(
    @Req() r: Request,
    @Res() res: Response,
  ) {
    if (!readConfig().googleOAuthEnabled) throw new NotFoundException();
    return this.google.finish(r, res);
  }
}
