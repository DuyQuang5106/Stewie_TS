# Preparation status (2026-11-06)

Target: Windows PC, https://stewiesat.com, retain current database.

Completed:
- Added separate server Compose candidate; local Compose untouched.
- Compose schema/interpolation validation passed using sample values, including public profile.
- Secrets and backup paths ignored by Git.
- Source confirmed: stiu-local-database-1, database stewie_local, shared named volume
  stewie-local-data, PostgreSQL 17.11, server timezone Etc/UTC.
- Logical backup: backups/stiu-server-preparation.dump (not committed).
- SHA256: E0998697598BEC2CC5460DD25C42960FE1C9FC5AC7D3C8A5CEC6F91644679BF9
- pg_restore completed with --exit-on-error in isolated PostgreSQL 17 container.
- Source and restored database: 33 public tables, 16 successful Flyway history rows,
  30 users. This is a restore sanity check, not a complete row-by-row audit.
- Temporary restore container removed; source database returned to stopped state.

Important: stiu-local-database-1 and stewie-local-db reference the SAME source
volume. Never start both simultaneously.

Pending:
- Actual .env secrets, production Google client and registered HTTPS callback.
- Confirm ownership/DNS access for domain; create tunnel and token.
- Review least-privilege DB role (candidate uses postgres).
- Match old JWT lifetimes and secret if retaining sessions; verify backend timezone.
- Real HTTPS/Google acceptance; full business-flow browser tests remain pending.
- Verify ADMIN account and review retained local-smoke fixtures.
- Registry workflows/image publishing are optional follow-up; first PC setup builds source.
- Windows PC installation, final cutover backup, restore, real Google browser flow,
  restart and scheduled off-PC backup tests.

No image has been published and no public tunnel has been started by this preparation.

Laptop validation completed:
- Backend typecheck, lint, unit/foundation (6 tests), e2e (1 test) passed.
- Both production Docker images built successfully. Frontend build/typechecking passed
  with four existing CSS ::highlight parser warnings.
- Separate stiu-laptop-verify project restored the dump into its own new volume.
- All three services healthy. Thirteen HTTP checks passed for login page, direct
  and frontend-proxied identity/catalog/analytics reads, unauthenticated rejection
  and disabled dev-login. Existing ADMIN/STUDENT users were read with ephemeral
  test JWTs; no source database writes or real Google login were performed.
- Verification project stopped; its separate restored volume remains for inspection.
- Backup checksum file and private Drive/USB transfer instructions prepared.
