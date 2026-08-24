---
name: seiten-sortieren-mehrfachauswahl-review
description: Security review of the drag-and-drop spread/page reordering and multi-select rect batch feature (branch mehrfachauswahl-seiten-sortieren, 2026-08) — what was checked and ruled out
metadata:
  type: project
---

Reviewed the working-tree diff for three new features: drag-and-drop reordering of
spreads/single pages in Overview.tsx (`PATCH /api/spreads/:index/position`,
`PATCH /api/spreads/page/:atPage/position`), multi-select move/scale/remove on the
spread stage (`PATCH /api/spreads/:index/slots/rects`), and their undo bookkeeping.

**Checked and clean**:

- All three new mutating routes are correctly listed in `UNDO_ROUTEN`
  (`routes/undo.ts`) — Origin check from [[csrf-model]] covers them, confirmed via
  `undo-rundlauf.test.ts` roundtrip tests added for each.
- `moveSpread`/`moveSinglePage` (`project/seiten.ts`, `core/layout/single-page.ts`):
  index/`von`/`vonPage` params from `Number(req.params...)` can be `NaN` (no
  `Number.isFinite` guard at the route level, unlike some sibling routes) but this
  degrades gracefully everywhere it was traced — `array[NaN]` is `undefined`,
  `eintragAn`/`folgeIndexVon` loop conditions are false for `NaN` comparisons and
  fall through to `-1`/`folge.length`, both handled as "not found". No crash path
  found. `nach`/`nachPage` are checked with `typeof === 'number' && isFinite` at
  the route before being passed in, then clamped with `Math.min/max`.
  `Number.isFinite` checks on the two new position routes are slightly less
  thorough than neighboring routes stylistically but not a security gap.
- `setSlotRects` batch endpoint: no explicit array-length cap, but bounded in
  practice by Fastify's default 1 MiB JSON `bodyLimit` (no override found for this
  route — only `/api/videos` overrides `bodyLimit`, with its own `parseAs:
'buffer'` parser). Given the server binds to `127.0.0.1` only with no auth
  ([[csrf-model]]), this isn't a realistic remote DoS vector.
- `aufsBlatt` (`core/layout/einwurf.ts`) clamps all rect values (x/y/w/h) onto the
  sheet bounds via `Math.min/max` — validated numeric input can't produce
  out-of-bounds geometry that would break PDF rendering.
- `slotId` is only ever used as `Array.prototype.find` comparison key
  (`s.slotId === slotId`), never as a bracket-notation property access on a plain
  object — no prototype-pollution vector, consistent with the rest of the codebase.
- Client-side drag-and-drop (`Overview.tsx`) uses custom MIME types
  (`application/x-franibook-spread`/`-seite`) purely to disambiguate drop targets;
  payload is `Number(...)` + `Number.isFinite` checked both client- and
  server-side. No `dangerouslySetInnerHTML`/`innerHTML`/`eval` anywhere in the
  touched web files. Cross-origin drag-and-drop exploitation is theoretical at
  best and wouldn't cross any privilege boundary this app has (there is none).

**One LOW finding**: see [[rects-undefined-gap]] — `setSlotRects` lacks the
per-element `rect ?? null` normalization that the singular `setSlotRect` route has,
so an array item with a missing (not explicit `null`) `rect` key throws instead of
returning a clean 400.
