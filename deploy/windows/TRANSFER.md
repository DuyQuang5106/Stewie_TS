# Transfer to Windows PC

Use a private Google Drive folder, USB drive or an authenticated LAN share.
Never publish the database dump in GitHub or an anonymous link. It contains user
data. Secrets (.env) must also stay private and must not be sent in chat.

Upload these two files from the ignored `backups` directory:
- stiu-server-preparation.dump
- SHA256SUMS.txt

On PC download both into `C:\Server\stw-ts\deploy\windows\backups` and verify:

```powershell
Get-FileHash .\backups\stiu-server-preparation.dump -Algorithm SHA256
Get-Content .\backups\SHA256SUMS.txt
```

Hashes must match before restore. Current SHA256:
`E0998697598BEC2CC5460DD25C42960FE1C9FC5AC7D3C8A5CEC6F91644679BF9`.

This backup was made on 2026-11-06. If the source database is used again, take a
new final backup with writes paused and regenerate the checksum. Do not accidentally
restore the older snapshot at cutover. Do not delete the source until PC acceptance.

Source checkouts on PC must be siblings:

```powershell
cd C:\Server
git clone --branch feat/auth-migration https://github.com/DuyQuang5106/Stewie_TS.git stw-ts
git clone --branch main https://github.com/leedoekahn401/stiu_fe.git stiu_fe
cd stw-ts\deploy\windows
```

Use the exact frontend commit in RELEASE.md. Use the backend commit that adds this
release document (or the exact backend SHA reported with the handoff). Create `.env`
from the example, restore the database and build images using README.md.
No registry account is required for source builds; Docker still needs Internet to
download base images/dependencies. No transfer has occurred until PC confirms the hash.
