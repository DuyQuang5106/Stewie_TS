> Historical source documentation imported from stiu_base/api-ts. See the root README for commands in this repository.

# Staging readiness (not deployed)

Use a separate hostname, deployment and PostgreSQL staging database. Never reuse
the local Java database or production database for staging failure tests.

Required runtime: the built image (Node 24.14.0), PORT=3001,
NODE_ENV=production, DATABASE_URL and explicit CORS_ALLOWED_ORIGINS.
Inject secrets through the hosting provider. Configure valid TLS for remote DBs.
Prefer a separate DB role with CONNECT and the least privileges necessary.
The current health query needs no application table permissions.

Deploy checklist:

1. Build/tag the tested image with its source commit; retain the previous tag.
2. Supply staging configuration and PostgreSQL connectivity.
3. Configure readiness `/health/ready` and liveness `/health/live`.
4. Allow at least 15 seconds termination grace; requests/DB operations have bounded timeouts.
5. Verify both endpoints return 200 and permitted-origin preflight succeeds.
6. Inspect JSON logs for errors and ensure secrets are absent.
7. Confirm existing production/Cloudflare business routes still point to Java.

Rollback: route traffic away from the failing deployment, restore the previous
image tag and configuration, then repeat health checks. Do not roll back DB
schema: this phase introduces no migrations. On a first deployment with no prior
TypeScript version, stop the new deployment and keep the Java routes unchanged.

Actual deployment requires a hosting target, access and a dedicated staging DB.
Documentation readiness does not mean staging has been deployed successfully.
