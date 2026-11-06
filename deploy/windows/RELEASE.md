# PC setup handoff — 2026-11-06

- Frontend: https://github.com/leedoekahn401/stiu_fe
  - branch: main
  - commit: 417483a688005c7829ded7b73743be2592e01d6e
- Backend: https://github.com/DuyQuang5106/Stewie_TS
  - branch: feat/auth-migration
  - deployment commit: the commit introducing this file. Resolve once on laptop
    with `git log -1 --format=%H -- deploy/windows/RELEASE.md` and record on PC.
  - application baseline before preparation: 6f39a28
- Domain: https://stewiesat.com
- Database: PostgreSQL 17, restored from stewie_local; UTC.
- Backup SHA256: E0998697598BEC2CC5460DD25C42960FE1C9FC5AC7D3C8A5CEC6F91644679BF9
- Local tested images: stw-ts:server-candidate and stiu-fe:server-candidate.
  These tags exist on laptop only; PC must build them. No GHCR publication is required.

Build and read-only smoke verification passed; see PREPARATION_STATUS.md.
Before public launch provide real secrets, configure Google callback/Tunnel,
review DB privileges and run browser acceptance. Keep both source checkouts until
the initial PC build completes. Transfer backup separately using TRANSFER.md.
