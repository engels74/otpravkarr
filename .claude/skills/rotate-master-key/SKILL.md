---
name: rotate-master-key
description: Rotate OTPRAVKARR_SECRET for an existing otpravkarr SQLite database.
---

# Rotate the master key

1. Stop every application process that can write the target database.
2. Back up the database file selected by `DATABASE_PATH` (default:
   `./data/otpravkarr.sqlite`), including its SQLite WAL/SHM files when present.
3. Generate a distinct replacement: `openssl rand -base64 32`.
4. Run:
   `OLD_SECRET="<current>" NEW_SECRET="<replacement>" DATABASE_PATH="<path>" bun scripts/rotate-key.ts`
5. Require the script to report `Key rotation complete.` It wraps all config and user-credential
   re-encryption in one `BEGIN IMMEDIATE` transaction and rolls everything back on error.
6. Set `OTPRAVKARR_SECRET` to the replacement and start the application with `bun run start`.
7. Verify authenticated configuration reads and a provisioned user's streaming credentials.

Do not start the application with the replacement before step 4; existing encrypted values still
require the old key.
