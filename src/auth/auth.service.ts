import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { DatabaseService } from '../database.service.js';
import { readConfig } from '../config.js';
import { authError } from './auth.helpers.js';
import { javaIsBlank } from '../academic-write/question.binding.js';
export const tokenHash = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
export class OAuthFailure extends Error {
  constructor(public readonly code: string) {
    super('OAuth login failed');
  }
}
@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService) {}
  private async issue(c: PoolClient, userId: string) {
    const cfg = readConfig(),
      roles = (
        await c.query(
          'SELECT role FROM user_roles WHERE user_id=$1 ORDER BY role',
          [userId],
        )
      ).rows.map((r) => r.role);
    const refreshToken = randomBytes(32).toString('base64url');
    await c.query(
      'INSERT INTO refresh_tokens(id,user_id,token_hash,is_revoked,expires_at,created_at) VALUES($1,$2,$3,false,$4,$5)',
      [
        randomUUID(),
        userId,
        tokenHash(refreshToken),
        new Date(Date.now() + Math.floor(cfg.authRefreshMs / 1000) * 1000),
        new Date(),
      ],
    );
    const issuedAtMs = Date.now(),
      now = Math.floor(issuedAtMs / 1000),
      accessToken = jwt.sign(
        {
          sub: userId,
          roles,
          iat: now,
          exp: Math.floor((issuedAtMs + cfg.authAccessMs) / 1000),
        },
        cfg.jwtSecret,
        { algorithm: 'HS256' },
      );
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Math.floor(cfg.authAccessMs / 1000),
    };
  }
  async refresh(token: string, path: string) {
    const outcome = await this.db.writeTransaction(async (c) => {
      const now = new Date();
      const used = await c.query(
        'UPDATE refresh_tokens SET is_revoked=true WHERE token_hash=$1 AND is_revoked=false AND expires_at>$2 RETURNING user_id',
        [tokenHash(token), now],
      );
      if (!used.rowCount) {
        const old = (
          await c.query(
            'SELECT user_id,is_revoked FROM refresh_tokens WHERE token_hash=$1',
            [tokenHash(token)],
          )
        ).rows[0];
        if (!old)
          return { error: authError(401, 'Invalid refresh token', path) };
        if (old.is_revoked) {
          await c.query('DELETE FROM refresh_tokens WHERE user_id=$1', [
            old.user_id,
          ]);
          return {
            error: authError(
              401,
              'Refresh token was revoked. All sessions invalidated.',
              path,
            ),
          };
        }
        return { error: authError(401, 'Refresh token has expired', path) };
      }
      const user = (
        await c.query(
          'SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL',
          [used.rows[0].user_id],
        )
      ).rows[0];
      if (!user)
        return { error: authError(401, 'Invalid refresh token', path) };
      return { tokens: await this.issue(c, user.id) };
    }, 'auth');
    if (outcome.error) throw outcome.error;
    return outcome.tokens!;
  }
  async logout(token: string | undefined) {
    if (token !== undefined && !javaIsBlank(token))
      await this.db.writeTransaction(async (c) => {
        await c.query(
          'UPDATE refresh_tokens SET is_revoked=true WHERE token_hash=$1 AND is_revoked=false AND expires_at>$2',
          [tokenHash(token), new Date()],
        );
      }, 'auth');
  }
  async devLogin(email: string, name: string, role: string, path: string) {
    return this.db.writeTransaction(async (c) => {
      let user = (
        await c.query('SELECT id,deleted_at FROM users WHERE email=$1', [email])
      ).rows[0];
      if (user?.deleted_at)
        throw authError(409, 'Tài khoản này đã bị xóa', path);
      if (!user) {
        user = { id: randomUUID() };
        await c.query(
          'INSERT INTO users(id,email,name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
          [user.id, email, name, new Date()],
        );
        await c.query('INSERT INTO user_roles(user_id,role) VALUES($1,$2)', [
          user.id,
          role,
        ]);
      }
      return this.issue(c, user.id);
    }, 'auth');
  }
  async oauthLogin(claims: Record<string, unknown>) {
    return this.db.writeTransaction(async (c) => {
      const email = claims.email,
        sub = claims.sub;
      if (
        typeof email !== 'string' ||
        javaIsBlank(email) ||
        typeof sub !== 'string' ||
        javaIsBlank(sub)
      )
        throw new OAuthFailure('invalid_user_info');
      let user = (
        await c.query(
          "SELECT u.* FROM oauth_accounts o JOIN users u ON u.id=o.user_id WHERE o.provider='google' AND o.provider_user_id=$1 AND u.deleted_at IS NULL",
          [sub],
        )
      ).rows[0];
      if (!user) {
        const verified = claims.email_verified ?? claims.verified_email;
        if (verified !== true && String(verified).toLowerCase() !== 'true')
          throw new OAuthFailure('email_not_verified');
        user = (await c.query('SELECT * FROM users WHERE email=$1', [email]))
          .rows[0];
        if (user?.deleted_at) throw new OAuthFailure('account_disabled');
        const now = new Date();
        if (!user) {
          user = { id: randomUUID() };
          const name =
            typeof claims.name === 'string' && !javaIsBlank(claims.name)
              ? claims.name
              : email.split('@')[0];
          await c.query(
            'INSERT INTO users(id,email,name,created_at,updated_at,last_access_at) VALUES($1,$2,$3,$4,$4,$4)',
            [user.id, email, name, now],
          );
          await c.query(
            "INSERT INTO user_roles(user_id,role) VALUES($1,'STUDENT')",
            [user.id],
          );
        }
        await c.query(
          "INSERT INTO oauth_accounts(id,user_id,provider,provider_user_id,created_at,updated_at) VALUES($1,$2,'google',$3,$4,$4)",
          [randomUUID(), user.id, sub, now],
        );
      }
      if (user.deleted_at) throw new OAuthFailure('account_disabled');
      await c.query(
        'UPDATE users SET last_access_at=$2,updated_at=$2 WHERE id=$1',
        [user.id, new Date()],
      );
      return this.issue(c, user.id);
    }, 'auth');
  }
  async cleanup() {
    return this.db.writeTransaction(
      async (c) =>
        (
          await c.query('DELETE FROM refresh_tokens WHERE expires_at<$1', [
            new Date(),
          ])
        ).rowCount,
      'auth',
    );
  }
}
