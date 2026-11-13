# Backup & Restore (AT-19)

V1 runs a single SQLite database plus two on-disk trees. A consistent
backup captures all three **at the same logical point in time**.

## What to back up

| Data | Location (default) | Contents |
|---|---|---|
| Metadata | `data/forgegent.sqlite` (+ `-wal`, `-shm`) | accounts, roles, agents, releases, tasks, events, files, audit |
| Release snapshots | `data/releases/<releaseId>/` | immutable published application packages |
| Personal files | `data/files/` (or your configured workspace root) | user uploads + task artifacts |
| Skills | `data/skills/` | published skill packages |

## Consistent backup (recommended)

Use the SQLite online-backup API — it takes a snapshot even while the
web/runner processes keep writing — then copy the file trees:

```sh
# 1. Snapshot the database (run from the repo or inside the web container):
node -e "
const Database = require('better-sqlite3');
const src = new Database('data/forgegent.sqlite', { readonly: true });
const dst = new Database('backup/forgegent.sqlite');
src.backup(dst).then(() => { console.log('db snapshot ok'); process.exit(0); });
"

# 2. Copy the file trees (releases are immutable; files may be mid-write —
#    for strict consistency pause task creation during the copy, or use
#    filesystem snapshots e.g. ZFS/btrfs/LVM):
rsync -a data/releases/ backup/releases/
rsync -a data/files/    backup/files/
rsync -a data/skills/   backup/skills/
```

## Restore to a target environment (AT-19)

```sh
mkdir -p data && cp backup/forgegent.sqlite data/forgegent.sqlite
rsync -a backup/releases/ data/releases/
rsync -a backup/files/    data/files/
rsync -a backup/skills/   data/skills/
FORGEGENT_ADMIN_EMAIL=... FORGEGENT_ADMIN_PASSWORD=... docker compose up -d
```

Verification (matches the AT-19 acceptance):
1. accounts log in (or the initial-admin bootstrap is skipped because the
   users table is non-empty);
2. published agents are listed with the same versions and the release
   checksums still verify (`loadSnapshot` never throws);
3. file listings match the source environment, and downloads return the
   same content (checksums recorded in `files.checksum`).

## What is NOT recovered

- In-flight task leases: a restored task in `running` state is reclaimed as
  `interrupted` by the runner on its next sweep (AT-15 semantics) and can be
  continued by its owner.
