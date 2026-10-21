// Never let Bun's automatically loaded local .env redirect tests to a real DB.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/stiu_ci';
process.env.READ_API_ENABLED = 'false';
process.env.CORS_ALLOWED_ORIGINS = '';
delete process.env.APP_JWTSECRET;
