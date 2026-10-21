> Historical source documentation imported from stiu_base/api-ts. See the root README for commands in this repository.

# TypeScript API foundation

NestJS 11 / Node.js 24.14.0 / TypeScript strict. This is the migration foundation;
the first migrated read endpoints are opt-in. See [read API migration](READ_API_MIGRATION.md).

## Local development (PowerShell)

```powershell
cd api-ts
npm.cmd ci
Copy-Item .env.example .env
# Edit .env: set DATABASE_URL and allowed frontend origins.
npm.cmd run dev
```

Default port: 3001. Environment values are validated before listening.
Use a `postgresql://` connection URL, not the Java `jdbc:` URL. URL-encode
special characters in credentials. Configure TLS through the connection URL
for the target database; do not disable certificate verification.
The service does not log connection strings or query results.

- `GET /health/live`: process is serving HTTP; no DB access.
- `GET /health/ready`: `SELECT 1`, returns 200 when connected or 503 otherwise.

The server can start while the database is unavailable. Use readiness for
traffic routing and liveness for process/container checks. Database access
uses a bounded pg pool with connection/query timeouts and graceful shutdown.
It does not run migrations or modify the schema. Existing Flyway SQL remains
owned by the Java deployment until migration ownership is explicitly moved.
No ORM has been selected yet; validate transaction and locking requirements first.

Global DTO validation rejects unknown decorated DTO properties. Apply validation
decorators to each migrated request DTO. Foundation errors use Nest defaults;
match the Java error contract when migrating each business module.
Application logs are JSON on stdout. CORS uses an explicit comma-separated origin
allowlist with credentials; an empty list allows no cross-origin browser access.
CORS is not authentication. Migrated routes require explicit READ_API_ENABLED=true
and the shared Java JWT secret; see the migration guide before enabling them.
Do not route existing business traffic here yet.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd test
```

Tests cover invalid environment settings, HTTP liveness, unavailable DB readiness,
CORS and unmigrated routes. To verify a real PostgreSQL connection:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:55439/stiu_foundation_test'
npm.cmd test
Remove-Item Env:TEST_DATABASE_URL
```

CI runs with an isolated PostgreSQL service and also builds the container.

Node is pinned in `.node-version`, `.nvmrc`, `package.json`, Docker and CI.
Use `npm ci` to reproduce dependencies from the committed lockfile.
Local `.env` can use `stewiesat_test`, but only health/read-only checks may target
that existing Java-owned database. Do not stop it or run seeds/migrations against it.
Integration tests must use a disposable database named `stiu_ci` or
`stiu_foundation_test`; they reject other names. The separate command is:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@localhost:55439/stiu_foundation_test'
npm.cmd run test:integration
Remove-Item Env:TEST_DATABASE_URL
```

The integration suite simulates a broken network connection using a local TCP
proxy, then restores it. It checks real password rejection and DB session cleanup.
It does not stop your database server. Process signal shutdown on Linux is
verified separately by the container smoke test; Windows tests use `app.close()`.
No role creation or schema migration is performed by this application.

When running Docker on Windows, use `host.docker.internal` instead of `localhost`
to connect to PostgreSQL on the host. Do not edit the local `.env` for container use;
inject a separate connection URL. Never copy `.env` into the image.

See [verification status](VERIFICATION.md) and [staging/rollback](STAGING.md).

## Staging preparation

```powershell
docker build -t stiu-api-ts .
docker run --rm --env-file .env -p 3001:3001 stiu-api-ts
```

Inject staging secrets through the hosting platform; keep `.env` uncommitted.
Set NODE_ENV=production, PORT, DATABASE_URL and CORS_ALLOWED_ORIGINS.
Use a dedicated staging DB and a separate hostname. Configure its load balancer
readiness probe to `/health/ready`. Existing Cloudflare routes still target Java.
Staging deployment is pending selection/access to its hosting environment;
the provided Docker image is the deployment artifact.
