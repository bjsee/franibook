---
name: persisted-json-sanitizing
description: Why "__proto__" as a key in a hand-edited project.json is not real prototype pollution here, and the project's own convention for sanitizing untrusted persisted fields
metadata:
  type: project
---

`apps/server` persists `Project` state as `project.json` and reloads it with
`JSON.parse` (`load()`, `ankerZurueck()` in `apps/server/src/project.ts`). Several
fields are `Record<string, string>` maps built from that untrusted, possibly
hand-edited file (e.g. `abnahmen: Record<string, string>` added for the
Abnahmebericht feature, 2026-08).

**False-positive trap**: it looks like `{"abnahmen": {"__proto__": "evil"}}` in a
crafted `project.json` should pollute `Object.prototype`. It doesn't, because:

- `JSON.parse` creates properties via `CreateDataProperty`, not `[[Set]]` — a key
  literally named `__proto__` becomes an **own data property** on the parsed
  object, never triggering `Object.prototype`'s `__proto__` accessor/setter.
- `Object.fromEntries` (used by the project's own `abnahmenAus()` sanitizer, see
  below) has the same safe semantics.
- `structuredClone` (used in `Project.stand()`/`setzeStand()` for undo) also
  preserves `__proto__` as an inert own property, not a prototype change.

The setter _would_ fire if the value ever passed through `Object.assign(target,
source)` or `target[key] = source[key]` where `target` is a plain object without
an own `__proto__` property — that's the classic vector. Grep for `Object.assign`
near any loop over persisted-JSON keys before ruling this out in a new spot.

**Project convention worth reusing**: `project.ts` has `abnahmenAus(roh: unknown)`
— a dedicated sanitizer that rejects non-object/array shapes and filters entries
to `typeof value === 'string'` before ever assigning to `this.abnahmen`. This is
the pattern to expect (and to ask for, if missing) whenever a new
`Record<string, X>`-shaped field is added to `PersistedProject`: don't trust
`data.someMap ?? {}` blindly, look for/ask for the equivalent of `abnahmenAus`.
Comment in the code (project.ts, near `abnahmenAus`) explicitly cites this exact
class of bug ("Object.keys darauf ergäbe Schlüssel wie 0, 1, 2") as the reason it
exists — the team is already thinking about malformed hand-edited state.
