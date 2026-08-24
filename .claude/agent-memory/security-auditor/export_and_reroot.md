---
name: export-and-reroot
description: Why GET /api/export/:fileName and PATCH /api/sources/:id (root) aren't path-traversal or arbitrary-file-read findings
metadata:
  type: project
---

Two features added around 2026-08 (`7380f2e^..HEAD`) look like path-traversal
candidates on first read but are correctly hardened — don't re-flag without new
evidence:

**`GET /api/export/:fileName`** (`apps/server/src/routes/buch.ts`) streams a
generated PDF from `outDir` for viewing in-browser (`Content-Disposition: inline`).
It validates `fileName` against `EXPORT_DATEINAME` (`/^[a-zA-Z0-9_-]+\.pdf$/`,
`routes/kontext.ts`) before `join(outDir, fileName)` — the same regex used on the
write side (`POST /api/export/pdf|abzug|cover`). No `..`, no `/`, no leading dot
possible. Covered by `routes/export-dateiname.test.ts`, which explicitly asserts
`%2F`-encoded traversal attempts get a `400` (not just "not 200") to prove the
handler is actually reached and the regex is what's rejecting it. It's a GET, so
[[csrf-model]]'s Origin check doesn't apply to it — but that's fine per the code
comment: a cross-origin page can trigger the GET but can't read the response
without a CORS grant the server never sends (same reasoning as
`GET /api/photos/:id/original`).

**`PATCH /api/sources/:id` with `root`** (`Sources.reroot`, `apps/server/src/sources.ts`)
lets the caller repoint an existing photo source at an arbitrary absolute
directory path from the request body. This looks like it hands out arbitrary
filesystem read, but it's the intended feature ("ein umgezogener Ordner ist kein
neuer Ordner" — `.claude/rules/server.md`): it only changes where an _existing_
source's files are looked up, doesn't re-import, and is fully covered by the
Origin check (`PATCH /api/sources/:id` has a real, non-null `UNDO_ROUTEN` entry —
see [[csrf-model]]). Given the server's no-auth/localhost-only threat model, a
same-machine caller repointing a source is not a privilege escalation.
