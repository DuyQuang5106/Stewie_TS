# Windows PC deployment candidate

This is a separate production Compose project. It does not reuse or modify the
local `stewie-local-data` volume. Run commands here (`stw-ts/deploy/windows`).
Keep `stw-ts` and `stiu_fe` as sibling directories when building from source.
The frontend Dockerfile and config changes must be committed in its own repo.

## Status and decisions

- Target: Windows PC; retain the existing database using logical backup/restore.
- Domain, Google production credentials and tunnel token are not supplied yet.
- This configuration is a candidate, not proof of a verified deployment.
- Database and backend have no host ports. Frontend binds only to loopback.
- Public access is opt-in through the `public` profile.
- Feature writes are enabled; review these flags before using real data.
- Scheduler/cleanup stay off until Java job ownership is deliberately switched.
- Keep Node/PostgreSQL timezone aligned with the source database. The sample TZ
  is only a default; verify it before restore, especially timestamp-without-timezone data.

## Laptop preparation

1. Start Docker Desktop in Linux container mode.
2. Copy `server.env.example` to `.env` and replace placeholders. Use a public HTTPS
   origin without a trailing slash. Keep secrets outside Git. Do not paste resolved
   `docker compose config` output into chat: it includes secrets.
3. Confirm the source database name, PostgreSQL version, extensions, timezone and
   container name. Do not guess them from the old Compose file.
4. Make a custom-format backup using the source database owner. Example ONLY;
   replace SOURCE_CONTAINER and SOURCE_DATABASE with inspected values:

```powershell
New-Item -ItemType Directory -Force backups
docker exec SOURCE_CONTAINER pg_dump -U postgres -d SOURCE_DATABASE -Fc -f /tmp/stiu-transfer.dump
docker cp SOURCE_CONTAINER:/tmp/stiu-transfer.dump ./backups/stiu-transfer.dump
if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed' }
Get-FileHash ./backups/stiu-transfer.dump -Algorithm SHA256
```

Check the exit code after every Docker command before continuing. `docker cp`
avoids binary output redirection through Windows PowerShell. Backups contain user
data and token hashes: transfer securely and keep an off-PC copy. The source is
read-only for pg_dump. A final cutover backup needs writes paused, otherwise changes
made after the snapshot will be absent on the PC.

## Restore rehearsal and PC setup

Use this procedure first on the laptop's separate `stiu-server` volume, then on PC.
Never run restore against the source/local project. Use PostgreSQL 17 only after
checking source-version compatibility. A dump from a newer major version may need
a newer target and client. This stack does not run Java/Flyway migrations; restoring
the existing complete schema supplies tables and migration history.

```powershell
docker compose config --quiet
docker compose up -d database
docker compose cp ./backups/stiu-transfer.dump database:/tmp/stiu-transfer.dump
docker compose exec -T database pg_restore -U postgres -d stiu_prod --no-owner --no-privileges --exit-on-error /tmp/stiu-transfer.dump
```

The restore example assumes `POSTGRES_DB=stiu_prod`, a fresh empty target, and a
single application database. Adjust the name if changed. Do not repeat restore
over an existing populated database. Confirm tables, counts, migration history,
ADMIN roles and representative application data after restore. Source roles/grants
are not restored by these options; this initial candidate uses postgres as the app
user and needs a least-privilege role review before public launch.

Build locally (requires both repo checkouts) and start without public ingress:

```powershell
docker compose build
docker compose up -d backend frontend
docker compose ps
docker compose logs --tail 100 backend frontend
```

Check http://localhost:3000/login. Secure cookies intentionally require the HTTPS
domain for full login acceptance. Backend readiness checks connectivity only, not
schema completeness. Verify business routes separately.

## Domain, Google and Tunnel

Register `${PUBLIC_ORIGIN}/login/oauth2/code/google` (replace with the actual URL)
in Google Cloud. The backend uses this explicit callback, not forwarded Host headers.
New Google users receive STUDENT; retain/verify an existing ADMIN account.

Create a named tunnel in Cloudflare and map the chosen public hostname to
`http://frontend:3000`. Put its token in `.env`, then:

```powershell
docker compose --profile public up -d tunnel
```

Test Google login, callbacks, Secure/HttpOnly cookies, reload, refresh, logout,
ADMIN/STUDENT permissions and an assessment/vocabulary flow. Confirm mocks are off.
Keep API/auth responses uncached. Test from another network. Stop public ingress:

```powershell
docker compose --profile public stop tunnel
```

## Images, updates and rollback

Initially build on PC using the two checkouts. For registry deployment, publish
tested images to GHCR with immutable commit/release tags, set BACKEND_IMAGE and
FRONTEND_IMAGE, authenticate with read-only package access if private, then run:

```powershell
docker compose pull backend frontend
docker compose up -d --no-build backend frontend
```

No GHCR publishing workflow is provisioned by this candidate. Record both image
tags, both Git commits, dump SHA256 and deployed config version for each release.
Pin the tested PostgreSQL and cloudflared image digests before launch. To roll back
application code, select the previous pair of image tags and repeat pull/up. A
database restore is a separate recovery operation and loses subsequent writes;
do not automatically roll back database data with application code.

## Windows operations

Enable virtualization/WSL2, start Docker Desktop, disable sleep while serving and
test a full reboot. Docker Desktop startup at sign-in is not guaranteed unattended
boot; verify your intended login/startup behavior. Restart policies act only after
the Docker engine starts. An unhealthy container is not automatically restarted
by the healthcheck alone.

Schedule daily pg_dump backups, retain multiple versions off-PC and rehearse restore.
The source dump can contain local-smoke fixtures: review which data should go live.
Never use `docker compose down -v` on the server: it deletes the database volume.
Do not copy Docker's live database volume files between Windows machines.

Official references:
- https://developers.cloudflare.com/tunnel/get-started/
- https://docs.docker.com/desktop/settings-and-maintenance/settings/
- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
