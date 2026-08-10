---
name: settings-route-typing
description: PATCH /api/settings (and POST /api/generate) rely on TypeScript body types for documentation only, not runtime validation — an established, accepted pattern, not a per-field regression to keep re-flagging
metadata:
  type: project
---

`apps/server/src/routes/projekt.ts`, `PATCH /api/settings`: the `Body` type
(`timeline?: boolean`, `tilt?: number`, `frame?: string`, `pageNumbers?: boolean`,
…) is a compile-time-only TypeScript annotation. Fastify is registered here
without a JSON schema (`grep -n schema apps/server/src/app.ts` finds none for
this route), so nothing rejects a request that sends `pageNumbers: "no"` (a
truthy string) or `tilt: "x"` at runtime.

**Why this isn't a real finding**: closed-set/numeric fields (`frame`, `background`,
`timelineFootVariant`, `timelineSideVariant`, `timelineAccent`) are all guarded
individually against their allowed values before being assigned
(`isFrameId`, `isBackgroundColor`, `Number.isFinite(req.body.tilt)`, membership
checks against `TIMELINE_*` arrays) — see the comments in that file explaining
_why_ ("ein unbekannter Wert wird stillschweigend übergangen"). Only the plain
boolean toggles (`timeline`, and now `pageNumbers`, added 2026-08 for the page-
number feature) skip a `typeof === 'boolean'` check and assign
`req.body.x` directly whenever it is `!== undefined`. This is a **consistent,
repeated pattern across every boolean setting**, not something newly introduced
by one feature — treat a missing `typeof` guard on a new boolean toggle field as
matching established convention, not as a fresh defect, unless the field feeds
something more dangerous than a render-time on/off switch (e.g. an array index,
a file path, or a numeric value used unclamped in geometry/memory allocation).

**`POST /api/generate`** is broader still: `project.settings = { ...project.settings,
...req.body }` merges the entire request body into settings with zero per-field
validation, for any key that happens to exist on `ProjectSettings` — including
`pageNumbers` automatically, just by virtue of the interface growing. This
pre-dates the page-number feature and is a standing accepted gap in this specific
route, not a regression to attribute to whichever feature happens to add the next
settings field. Both routes are no-auth/localhost-only by design, see
[[csrf-model]] — worst case is corrupting the local user's own project.json, not
a cross-user or remote-attacker issue.

No prototype-pollution concern in either merge: both `data.settings` (loaded via
`JSON.parse`) and `req.body` (Fastify's default JSON body parser) produce plain
objects via `CreateDataProperty`, so a spread merge (`{...target, ...source}`)
copies `__proto__` as an inert own key rather than triggering the accessor — same
reasoning as [[persisted-json-sanitizing]], just via spread instead of
`Object.fromEntries`.
