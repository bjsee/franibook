---
name: query-type-confusion
description: Fastify query-string routes here have no runtime schema validation — repeated query keys become arrays and silently defeat string-typed filter logic; confirmed crash in GET /api/photos?ort=
metadata:
  type: project
---

`apps/server` routes type `Querystring` generics as TypeScript interfaces only
(`app.get<{ Querystring: { ort?: string; ... } }>`) — there is **no** Fastify
JSON-schema validation attached (`grep -n schema apps/server/src/routes/*.ts`
comes back empty). Same class of gap as [[settings_route_typing]] (TS body
types aren't runtime checks), but here it bites harder because a client can
trigger it _by accident_, not just by crafting a malicious request: Fastify's
querystring parser turns a **repeated** key into an array
(`?ort=a&ort=b` → `{ ort: ['a', 'b'] }`), not a validation error.

**Confirmed via `app.inject` against `apps/server/src/routes/fotos.ts`**
(`filterAus`, `apps/server/src/project/filter.ts`, 2026-08, Bestandsfilter
feature):

- `?ort=a&ort=b` → **500**, `{"message":"gesucht.toLocaleLowerCase is not a
function"}` — `ortPasst()` in `filter.ts` (~line 156-162) assumes `gesucht:
string` and calls `.toLocaleLowerCase()` on it unchecked; an array reaches
  that line because `fotos.ts` (`if (query.ort !== undefined) filter.ort =
query.ort;`) never validates the _type_ of `ort`, only its presence. This
  directly contradicts the route's own documented contract ("ein
  unbrauchbarer Wert ist ein 400, keine stille Auslassung", `.claude/rules/
server.md` § "Den Bestand durchsuchen") — it's a 500 with an internal
  message, not a 400.
- `?quelle=a&quelle=b`, `?gruppe=a&gruppe=b` → **200**, `count: 0` — strict
  `!==` comparisons against a string field make an array never match, so the
  route silently returns "no results" instead of erroring. This is the exact
  failure mode the filter's own module comment warns against ("eine Liste,
  die etwas anderes zeigt als angefragt, und würde ihr glauben") — just
  reached through a gap the author didn't anticipate rather than the ones
  they guarded (`von`/`bis`/`platziert`/`konfidenz` all _do_ correctly 400 on
  an array, because they run through an explicit whitelist/regex check first).
- `?von=...&von=...`, `?platziert=...&platziert=...`, `?konfidenz=...&...`
  correctly degrade to 400 (regex/`.includes()` checks reject non-matching
  array-as-string coercion) or are unaffected (`problems`, `ohneDatum` are
  presence-only flags).

**Practical severity stays low, not because the bug isn't real, but because
of the threat model** ([[csrf_model.md]]: server binds `127.0.0.1` only, no
auth). A cross-origin page _can_ fire this as a simple unauthenticated GET
(no preflight, per the CSRF memory) but can't read the JSON response without
CORS headers — so it's a local self-inflicted crash/wrong-answer bug, not a
remote information leak. Still worth fixing (validate `ort`/`quelle`/
`datumsquelle`/`gruppe` are `typeof === 'string'` before use, same as the
already-present checks on `platziert`/`von`/`bis`/`konfidenz`).

**Pattern to check on any future query-string route with free-text or
identifier-shaped params** (not just enum/regex-shaped ones): does every
field that skips the "known small set of values" validation path also get a
`typeof value === 'string'` guard before being handed to a string method
(`.toLowerCase()`, `.includes()`, `.slice()`, …)? The regex/enum-checked
fields in this same route already do the right thing by construction; it's
specifically the "identifiers, unchecked because unknown values are a valid
answer" fields that are exposed.
