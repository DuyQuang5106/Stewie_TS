export interface AppConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  readApiEnabled: boolean;
  academicWriteApiEnabled: boolean;
  vocabularyApiEnabled: boolean;
  assessmentApiEnabled: boolean;
  assessmentSchedulerEnabled: boolean;
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
    jwtSecret,
  };
}
