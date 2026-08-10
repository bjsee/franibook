---
name: csrf-model
description: How franibook's server defends against CSRF despite no auth — Origin header check tied to the same UNDO_ROUTEN table used for undo history
metadata:
  type: project
---

The server (`apps/server`) has **no authentication** and binds only to `127.0.0.1`
by design (documented in `.claude/rules/server.md`, section "Sicherheit"). This is
an accepted risk, not an oversight — do not flag it on its own.

The actual CSRF defense is `ursprungHaken` in `apps/server/src/routes/undo.ts`:

- Every mutating route (`POST`/`PATCH`/`PUT`/`DELETE`) **must** have an entry in
  `UNDO_ROUTEN` (`null` if it doesn't change project state). `eintragFuer()` looks
  up `${method} ${url}` in that table.
- `ursprungHaken` runs as a `preHandler` hook registered _before_ the route
  modules, and rejects (403) any request in `UNDO_ROUTEN` whose `Origin` header
  resolves to a hostname other than `localhost`/`127.0.0.1`. A **missing** Origin
  header is let through deliberately (curl, Playwright, same-origin edge cases) —
  only a _forged_ Origin is treated as an attack signal, since the header itself
  is unforgeable by page JS.
- `undo.test.ts` cross-checks that `UNDO_ROUTEN` lists every registered mutating
  route with no gaps — so a new route missing from the table fails a test, not
  just a manual review.

**When auditing a new mutating route**: check it has an entry in `UNDO_ROUTEN`
(even if `null`). If it's there, the Origin check automatically covers it — no
per-route CSRF work needed. Verified for `POST /api/book/pruefung/abnahmen` and
`DELETE /api/book/pruefung/abnahmen` (2026-08, Abnahme-Bericht feature) — both
correctly listed, both protected.

Also note: `DELETE` and JSON-content-type `POST` already require a CORS
preflight in browsers; since the server sends no CORS headers, cross-origin
fetch() to these routes is blocked by the browser _before_ the Origin check even
matters. The Origin header check mainly protects **simple requests** (bodiless
`POST`, or `POST`/`GET` with a "safelisted" content type like `text/plain` /
form-urlencoded) that skip preflight — e.g. `/api/undo`, `/api/redo`,
`/api/generate`.
