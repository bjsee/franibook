---
name: frei-platzieren-move
description: Why the freihand-platzieren branch (MoveTarget kind 'frei', moveToFrei, locked-bypass in einwurf.ts) has no new exploitable finding — spreadIndex type-confusion crashes instead of polluting
metadata:
  type: project
---

Reviewed 2026-08-17 on branch `freihand-platzieren` (uncommitted): new
`MoveTarget` variant `{ kind: 'frei', spreadIndex, punkt }` and `moveToFrei` in
`packages/core/src/layout/move.ts`, the `stelleGueltig` guard in
`apps/server/src/routes/buch.ts`, and the loosened `locked` check in
`apps/server/src/project/einwurf.ts` (`if (spread.locked && !ziel.punkt)`).

**`target.punkt` (x/y) is properly validated** at the route (`stelleGueltig`):
both must be `typeof number`, finite, in `[0,1]`. Same pattern as the existing
file-drop validation (`lesePunkt` in `routes/spreads.ts`) — no gap here.

**`target.spreadIndex` has no runtime type check** (TS `Body` generic is
compile-time only, per [[settings_route_typing]]) — but this is _not new_:
the pre-existing `kind: 'spread'` path (`moveToSpread`) has the exact same gap
(`if (!ziel)` where `ziel = spreads[zielIndex]`). Traced the exploit path for
`spreadIndex: "__proto__"` or `"constructor"` end to end: `spreads["__proto__"]`
returns `Array.prototype` (truthy), so the existence guard passes wrongly, but
`kopie[target.spreadIndex]` in the _next_ step also resolves to
`Array.prototype`/`Array` (constructor), which is then passed as the `spread`
argument into `mitEinwurf` → `einwurfPlatzId` does `spread.slots.map(...)` →
throws `TypeError` on `undefined.map` _before_ any assignment back into
`kopie[target.spreadIndex]` happens. Net effect: an unhandled per-request
exception (Fastify 500), not prototype pollution with state impact — the
assignment line (`kopie[target.spreadIndex] = neu`) is never reached. Per
[[persisted_json_sanitizing]]'s standard (need proven state impact, not just a
special-key type-confusion crash), this does not qualify as a finding, and
DoS/crash-only findings are out of scope per this project's audit brief.

**`einwurf.ts` locked-bypass**: the diff only changes the _condition_ under
which the locked-check rejects (`&& !ziel.punkt`) — it does not touch file
path resolution, which still only happens under `<erste Quelle>/eingeworfen/`
elsewhere in the same file (unchanged in this diff). No new file-write surface.

**`generate.ts`/`rebuild.ts` (`jahresStrom`, `mulberry32`, `jitter`)**: pure
deterministic math over `settings.seed`, no I/O, no attacker-controlled string
used as path/key. Not security-relevant.

Don't re-flag any of the above without new evidence (e.g. a code path that
actually reaches the `kopie[idx] = value` assignment with a special key before
throwing, or a path where `spreadIndex`/`punkt` reach `fs`/template lookups by
string key).
