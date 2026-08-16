---
name: mosaik-feature-review
description: Security review findings for the Titelmosaik feature (frontMosaic, /api/cover/mosaik*) — what's safe and the one convention gap found
metadata:
  type: project
---

Reviewed 2026-08-16 (branch `worktree-titelmosaik`, uncommitted). Feature: cover
title image assembled from many small photos, driven by `PATCH /api/cover`
`frontMosaic` (text/family/photoId/cols/gap/tint/reuseCost/padding/seed/inverted).

**Safe by construction, checked and ruled out:**

- `fontFilePath(family, weight)` (`packages/fonts/src/index.ts`) indexes a fixed
  `Record<FontFamilyId,...>` with a runtime-arbitrary `family` string (no schema
  validation at the API boundary — same as [[settings_route_typing]]). Tried
  `"constructor"`, `"__proto__"`, `"toString"`: all resolve to a prototype-chain
  value whose `.regular` is `undefined`, so the function throws its own
  controlled `Error` — it never reaches `fileURLToPath`/`readFileSync` with an
  attacker string. No path traversal, no prototype pollution (this is a _read_,
  nothing is ever assigned through `family`).
- `textAlsSvg` (`apps/server/src/mosaik/ziel.ts`) does NOT interpolate user text
  into SVG markup — `frontMosaic.text` goes through `fontkit.layout()`, and only
  the resulting glyph `path.toSVG()` (numeric path data from the font engine) is
  written into the `<path d="...">`. No SVG/XML injection vector even though the
  text is otherwise unvalidated.
- `GET /api/cover/mosaik/:abdruck` validates against `MOSAIK_ABDRUCK =
/^[a-z0-9]{1,16}$/` before `join()` — solid allowlist, no traversal.
- Numeric mosaic settings (cols/gap/tint/seed/padding) are clamped/defaulted
  throughout with `Math.max`/`Number.isFinite` before reaching `sharp` — no
  negative dimensions or NaN reach image operations (pure DoS/resource concerns
  excluded from scope anyway).
- `updateCover`'s `{ ...z.cover, ...(patch as Partial<CoverDesign>) }` (object
  spread) is not vulnerable to `__proto__`-key prototype pollution: spread uses
  `CopyDataProperties`/`CreateDataProperty`, not `[[Set]]`, so a `"__proto__"`
  key in the parsed JSON body becomes a literal own property, not a prototype
  override. Same reasoning applies anywhere else in the repo using object
  spread on a parsed JSON body.

**One real gap found — convention violation, low practical severity:**
`zielAusFotoKennung` (`apps/server/src/project/titelmosaik.ts`, calls
`bilder.get(photo, 'preview')` then `zielAusFoto`) has no try/catch. If the
referenced photo's preview isn't cached yet and the underlying source file is
unreachable (unmounted NAS, exactly the scenario [[csrf_model]]'s sibling docs
worry about elsewhere), `sharp()`/decode errors carry the raw filesystem path
in `err.message`. This propagates uncaught through `planeTitelmosaik` →
`backeTitelmosaik` → `Project.titelmosaikSicherstellen`'s catch
(`apps/server/src/project.ts`), which does `String(err.message)` **without**
routing it through `istDateiFehler` (`apps/server/src/routes/kontext.ts`) the
way `umschlag.ts`'s export route and other file-facing routes do. The raw
message then lands in the HTTP response (`hints` array via `coverAntwort`, and
the `POST /api/export/cover` 409 body).

Contrast: `kachel()` in `apps/server/src/mosaik/backen.ts` has the _same_ kind
of error (missing/unreadable preview) but it's swallowed per-tile
(`catch { gescheitert++; }`) — so the tile-baking path does NOT leak, only the
"Zielbild" (target/color-source photo) lookup path leaks.

Practical severity is low despite being a real convention violation: the
server is localhost-only with no auth ([[csrf_model]]) and no CORS headers, so
no cross-origin page can read the response body anyway, and the only party who
can see the leaked path is the same local user who already has full filesystem
access. Worth a one-line fix (wrap `zielAusFotoKennung`'s body or the call site
in `planeTitelmosaik` with the same `istDateiFehler` → generic-message pattern)
for consistency, but not something to lose sleep over.

**Pattern to check on future mosaic/image-pipeline changes:** any new code path
that calls `previews.get()` / `sources.pfad()` and lets the result reach an HTTP
response on error should route through `istDateiFehler`, not just
`err.message`. Grep `titelmosaikSicherstellen`-style `catch` blocks for this.
