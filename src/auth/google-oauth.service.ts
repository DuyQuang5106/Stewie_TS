import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import * as oidc from 'openid-client';
import { readConfig } from '../config.js';
import { AuthService, OAuthFailure } from './auth.service.js';
import { cookieValue } from './auth.helpers.js';
import { authCookies } from './auth.helpers.js';
interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
  expires: number;
}
@Injectable()
export class GoogleOAuthService {
  private configuration?: Promise<oidc.Configuration>;
  constructor(private readonly auth: AuthService) {}
  private config() {
    return (this.configuration ??= this.discover().catch((error) => {
      this.configuration = undefined;
      throw error;
    }));
  }
  private async discover() {
    const c = readConfig();
    return oidc.discovery(
      new URL(c.googleIssuer),
      c.googleClientId,
      { client_secret: c.googleClientSecret, [oidc.clockTolerance]: 300 },
      oidc.ClientSecretPost(c.googleClientSecret),
      {
        timeout: 5,
        execute: [
          ...(c.googleIssuer.startsWith('http:')
            ? [oidc.allowInsecureRequests]
            : []),
          oidc.enableNonRepudiationChecks,
        ],
      },
    );
  }
  private key() {
    return createHash('sha256')
      .update('stw-ts:oauth-state:' + readConfig().jwtSecret)
      .digest();
  }
  private seal(state: LoginState) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    return Buffer.concat([
      iv,
      cipher.update(JSON.stringify(state)),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64url');
  }
  private open(raw: string): LoginState {
    const b = Buffer.from(raw, 'base64url');
    if (b.length < 29 || b.length > 2048)
      throw new Error('Invalid login state');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      b.subarray(0, 12),
    );
    decipher.setAuthTag(b.subarray(-16));
    const s = JSON.parse(
      Buffer.concat([
        decipher.update(b.subarray(12, -16)),
        decipher.final(),
      ]).toString('utf8'),
    ) as LoginState;
    if (s.expires < Date.now() || s.expires > Date.now() + 601000)
      throw new Error('Expired login state');
    return s;
  }
  private cookie(res: Response, value: string, age: number) {
    res.append(
      'Set-Cookie',
      `stwOAuth=${value}; Path=/login/oauth2/code/google; Max-Age=${age}; HttpOnly; SameSite=Lax${readConfig().authCookieSecure ? '; Secure' : ''}`,
    );
  }
  private failure(res: Response, code: string) {
    const target = new URL(readConfig().oauthRedirectUri);
    target.searchParams.append(
      'error',
      [
        'access_denied',
        'email_not_verified',
        'account_disabled',
        'invalid_user_info',
      ].includes(code)
        ? code
        : 'oauth_failed',
    );
    res.redirect(302, target.toString());
  }
  async start(res: Response) {
    try {
      const config = await this.config(),
        state = {
          state: oidc.randomState(),
          nonce: oidc.randomNonce(),
          verifier: oidc.randomPKCECodeVerifier(),
          expires: Date.now() + 600000,
        };
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: readConfig().googleCallbackUri,
        scope: 'openid profile email',
        state: state.state,
        nonce: state.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(state.verifier),
        code_challenge_method: 'S256',
      });
      this.cookie(res, this.seal(state), 600);
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, url.toString());
    } catch {
      this.failure(res, 'oauth_failed');
    }
  }
  async finish(r: Request, res: Response) {
    this.cookie(res, '', 0);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const state = this.open(cookieValue(r.headers.cookie, 'stwOAuth') ?? '');
      const url = new URL(readConfig().googleCallbackUri);
      url.search = r.originalUrl.includes('?')
        ? r.originalUrl.slice(r.originalUrl.indexOf('?'))
        : '';
      if (
        url.searchParams.getAll('state').length !== 1 ||
        url.searchParams.get('state') !== state.state
      )
        throw new Error('State mismatch');
      if (url.searchParams.has('error'))
        return this.failure(res, url.searchParams.get('error')!);
      const config = await this.config();
      const tokens = await oidc.authorizationCodeGrant(config, url, {
        expectedState: state.state,
        expectedNonce: state.nonce,
        pkceCodeVerifier: state.verifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error('Missing ID token');
      const userInfo = await oidc.fetchUserInfo(
        config,
        tokens.access_token,
        claims.sub,
      );
      const issued = await this.auth.oauthLogin({ ...claims, ...userInfo });
      authCookies(res, issued);
      res.redirect(302, readConfig().oauthRedirectUri);
    } catch (error) {
      this.failure(
        res,
        error instanceof OAuthFailure ? error.code : 'oauth_failed',
      );
    }
  }
}
