---
name: kontaktbogen-review
description: Security review outcome for the Kontaktbogen (contact sheet) feature appended to POST /api/export/abzug — no findings, notes on why
metadata:
  type: project
---

Reviewed 2026-08-11 on branch `kontaktbogen`: `packages/core/src/pruefung/kontaktbogen.ts`
(new), `packages/core/src/pruefung/abzug.ts` (adds optional `titel` alongside
`linkeSeite`), `apps/server/src/routes/buch.ts` (`POST /api/export/abzug` now
appends contact-sheet spreads for `project.fotosFiltern({ platziert: false })`
photos when `body.kontaktbogen !== false`). No findings. Reasoning, so it isn't
re-litigated on the next pass:

- **Body field `kontaktbogen?: boolean`** has no runtime/typeof guard — matches
  the established plain-boolean-toggle convention ([[settings-route-typing]]).
  It only gates whether contact-sheet spreads get appended (render-time on/off),
  not a file path, array index, or unclamped numeric value — so per that
  memory's own carve-out, not a fresh defect.
- **No new state mutation**: route stays `null` in `UNDO_ROUTEN` (unchanged,
  `apps/server/src/routes/undo.ts:335`), matches its pre-existing entry — the
  feature only writes an export file, same as before.
- **No path traversal**: `fileName` still validated by the unchanged
  `EXPORT_DATEINAME = /^[a-zA-Z0-9_-]+\.pdf$/` (`apps/server/src/routes/kontext.ts:30`).
  Photo `slotId`/`id` strings are never used to build filesystem paths — purely
  descriptive RSM metadata, confirmed unused in `render-pdf.ts` (`grep slotId`
  finds nothing there); `resolvePhoto` resolves through the existing
  `Sources.pfad()` / preview-cache map, unchanged.
- **No unintended photo leakage**: `fotosFiltern({ platziert: false })` reads
  from `this.photos` (in-memory project state), which already excludes
  `aussortiert` (removed) photos — a photo the user explicitly deleted from the
  project cannot resurface via the contact sheet. Showing _unplaced-but-still-
  in-project_ photos is exactly this feature's stated purpose (see the module's
  own doc comment), not a leak.
- **No DoS regression**: see [[render-pdf-streaming]] — streaming architecture
  and pre-existing full-library `previews.warm()` call mean appending contact-
  sheet sheets doesn't meaningfully change memory/runtime cost, even for a
  large unplaced remainder.
- **CSRF**: unaffected, covered by [[csrf-model]] since the route/method didn't
  change.

If a future change makes `kontaktbogen` (or a similar new body field) control
something more dangerous — e.g. `spalten`/`zeilen` becoming client-supplied, or
an arbitrary photo-id list from the client instead of a server-computed filter —
re-open the input-validation question at that point.
