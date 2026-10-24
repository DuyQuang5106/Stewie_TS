export interface AppConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  readApiEnabled: boolean;
  academicWriteApiEnabled: boolean;
  vocabularyApiEnabled: boolean;
  assessmentApiEnabled: boolean;
  assessmentSchedulerEnabled: boolean;
  analyticsApiEnabled: boolean;
  authCleanupEnabled: boolean;
  authApiEnabled: boolean;
  authDevLoginEnabled: boolean;
  authCookieSecure: boolean;
  authAccessMs: number;
  authRefreshMs: number;
  googleOAuthEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  googleIssuer: string;
  googleCallbackUri: string;
  oauthRedirectUri: string;
  jwtSecret: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (
    env.READ_API_ENABLED !== undefined &&
    !['true', 'false'].includes(env.READ_API_ENABLED)
  ) {
    throw new Error('READ_API_ENABLED must be true or false');
  }
  const readApiEnabled = env.READ_API_ENABLED === 'true';
  if (
    env.ACADEMIC_WRITE_API_ENABLED !== undefined &&
    !['true', 'false'].includes(env.ACADEMIC_WRITE_API_ENABLED)
  )
    throw new Error('ACADEMIC_WRITE_API_ENABLED must be true or false');
  const academicWriteApiEnabled = env.ACADEMIC_WRITE_API_ENABLED === 'true';
  if (academicWriteApiEnabled && !readApiEnabled)
    throw new Error('ACADEMIC_WRITE_API_ENABLED requires READ_API_ENABLED');
  for (const key of [
    'VOCABULARY_API_ENABLED',
    'ASSESSMENT_API_ENABLED',
    'ASSESSMENT_SCHEDULER_ENABLED',
    'ANALYTICS_API_ENABLED',
    'AUTH_API_ENABLED',
  ]) {
    if (env[key] !== undefined && !['true', 'false'].includes(env[key]!))
      throw new Error(key + ' must be true or false');
    if (env[key] === 'true' && !readApiEnabled)
      throw new Error(key + ' requires READ_API_ENABLED');
  }
  const vocabularyApiEnabled = env.VOCABULARY_API_ENABLED === 'true';
  const assessmentApiEnabled = env.ASSESSMENT_API_ENABLED === 'true';
  const assessmentSchedulerEnabled =
    env.ASSESSMENT_SCHEDULER_ENABLED === 'true';
  if (assessmentSchedulerEnabled && !assessmentApiEnabled)
    throw new Error(
      'ASSESSMENT_SCHEDULER_ENABLED requires ASSESSMENT_API_ENABLED',
    );
  const jwtSecret = env.APP_JWTSECRET ?? '';
  if (
    readApiEnabled &&
    (!jwtSecret.trim() ||
      jwtSecret.startsWith('CHANGE_ME') ||
      Buffer.byteLength(jwtSecret, 'utf8') < 32)
  ) {
    throw new Error(
      'APP_JWTSECRET must match Java and contain at least 32 UTF-8 bytes',
    );
  }
  for (const key of [
    'AUTH_DEV_LOGIN_ENABLED',
    'AUTH_CLEANUP_ENABLED',
    'AUTH_COOKIE_SECURE',
    'GOOGLE_OAUTH_ENABLED',
  ])
    if (env[key] !== undefined && !['true', 'false'].includes(env[key]!))
      throw new Error(key + ' must be true or false');
  const authCleanupEnabled = env.AUTH_CLEANUP_ENABLED === 'true';
  if (authCleanupEnabled && env.AUTH_API_ENABLED !== 'true')
    throw new Error('Cleanup requires AUTH_API_ENABLED');
  const authApiEnabled = env.AUTH_API_ENABLED === 'true',
    authDevLoginEnabled = env.AUTH_DEV_LOGIN_ENABLED === 'true',
    googleOAuthEnabled = env.GOOGLE_OAUTH_ENABLED === 'true';
  if ((authDevLoginEnabled || googleOAuthEnabled) && !authApiEnabled)
    throw new Error('Login requires AUTH_API_ENABLED');
  if (authDevLoginEnabled && env.NODE_ENV === 'production')
    throw new Error('Dev login cannot be enabled in production');
  if (
    authApiEnabled &&
    env.NODE_ENV === 'production' &&
    env.AUTH_COOKIE_SECURE !== 'true'
  )
    throw new Error('Production auth requires secure cookies');
  const authAccessMs = Number(env.APP_JWTEXPIRATIONMS ?? 900000),
    authRefreshMs = Number(env.APP_JWTREFRESHEXPIRATIONMS ?? 604800000);
  if (
    !Number.isSafeInteger(authAccessMs) ||
    authAccessMs < 1000 ||
    authAccessMs > 2147483647 ||
    !Number.isSafeInteger(authRefreshMs) ||
    authRefreshMs < 1000 ||
    authRefreshMs > 31536000000
  )
    throw new Error('Invalid auth token lifetime');
  const googleClientId =
      env.SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_ID ?? '',
    googleClientSecret =
      env.SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_SECRET ?? '',
    googleIssuer = env.GOOGLE_OIDC_ISSUER ?? 'https://accounts.google.com',
    googleCallbackUri =
      env.GOOGLE_CALLBACK_URI ??
      'http://localhost:3001/login/oauth2/code/google',
    oauthRedirectUri =
      env.APP_OAUTH2_REDIRECTURI ?? 'http://localhost:3000/oauth2/redirect';
  if (googleOAuthEnabled) {
    if (!googleClientId || !googleClientSecret)
      throw new Error('Google OAuth credentials are required');
    for (const raw of [googleCallbackUri, oauthRedirectUri]) {
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        throw new Error('Invalid OAuth redirect URL');
      }
      if (
        !['https:', 'http:'].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.hash ||
        (env.NODE_ENV === 'production' && u.protocol !== 'https:')
      )
        throw new Error('Invalid OAuth redirect URL');
    }
    if (googleIssuer !== 'https://accounts.google.com') {
      let u: URL;
      try {
        u = new URL(googleIssuer);
      } catch {
        throw new Error('Invalid Google issuer');
      }
      if (
        env.NODE_ENV !== 'test' ||
        !['localhost', '127.0.0.1'].includes(u.hostname) ||
        u.protocol !== 'http:'
      )
        throw new Error('Google issuer override is test-only');
    }
  }
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  let database: URL;
  try {
    database = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname ||
    database.pathname.length < 2
  ) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
  if (
    env.NODE_ENV !== undefined &&
    !['development', 'test', 'production'].includes(env.NODE_ENV)
  ) {
    throw new Error('NODE_ENV must be development, test or production');
  }
  if (env.NODE_ENV === 'production' && !env.CORS_ALLOWED_ORIGINS?.trim()) {
    throw new Error('CORS_ALLOWED_ORIGINS is required in production');
  }
  const corsOrigins = (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('Invalid CORS_ALLOWED_ORIGINS');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(
        'CORS_ALLOWED_ORIGINS must contain explicit HTTP(S) origins',
      );
    }
  }
  return {
    port,
    databaseUrl: database.toString(),
    corsOrigins,
    readApiEnabled,
    academicWriteApiEnabled,
    vocabularyApiEnabled,
    assessmentApiEnabled,
    assessmentSchedulerEnabled,
    analyticsApiEnabled: env.ANALYTICS_API_ENABLED === 'true',
    authCleanupEnabled,
    authApiEnabled,
    authDevLoginEnabled,
    authCookieSecure: env.AUTH_COOKIE_SECURE === 'true',
    authAccessMs,
    authRefreshMs,
    googleOAuthEnabled,
    googleClientId,
    googleClientSecret,
    googleIssuer,
    googleCallbackUri,
    oauthRedirectUri,
    jwtSecret,
  };
}
