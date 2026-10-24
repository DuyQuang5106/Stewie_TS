// Never let Bun's automatically loaded local .env redirect tests to a real DB.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/stiu_ci';
process.env.READ_API_ENABLED = 'false';
process.env.CORS_ALLOWED_ORIGINS = '';
delete process.env.APP_JWTSECRET;

process.env.ACADEMIC_WRITE_API_ENABLED = 'false';

process.env.VOCABULARY_API_ENABLED = 'false';
process.env.ASSESSMENT_API_ENABLED = 'false';

process.env.ASSESSMENT_SCHEDULER_ENABLED = 'false';

process.env.ANALYTICS_API_ENABLED = 'false';

process.env.AUTH_API_ENABLED = 'false';
process.env.AUTH_DEV_LOGIN_ENABLED = 'false';
process.env.GOOGLE_OAUTH_ENABLED = 'false';

process.env.AUTH_CLEANUP_ENABLED = 'false';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.APP_JWTEXPIRATIONMS = '900000';
process.env.APP_JWTREFRESHEXPIRATIONMS = '604800000';
