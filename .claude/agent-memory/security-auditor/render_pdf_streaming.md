---
name: render-pdf-streaming
description: renderPdf() streams images into pdfkit one at a time instead of buffering the whole document — relevant when assessing "more images/spreads = DoS?" questions
metadata:
  type: project
---

`packages/render-pdf/src/render-pdf.ts` pipes `pdfkit`'s output stream directly to
`createWriteStream(outputPath)` via `pipeline()`, and resolves/embeds each photo's
image one box at a time as the document is drawn — it does not build the whole
document or all decoded images in memory first. The module header comment cites
the measured reason: ~800 embedded images went from 4.9 GB (buffered) to 495 MB
(streamed) in a Phase 0 spike.

**Why this matters for audits**: when a feature adds more spreads/images to an
export (e.g. the Kontaktbogen contact-sheet sheets appended to `POST
/api/export/abzug`, 2026-08), the per-image memory cost doesn't accumulate — so
"more images now get rendered" is not on its own a memory-DoS finding. Also
relevant: `resolvePhoto` for the abzug path resolves from the 1600px preview
cache (already warmed by `previews.warm(project.effectivePhotoList(), ...)` for
_all_ project photos regardless of placement), so appending unplaced photos to
the abzug export doesn't trigger new/extra image decode work — that warm() call
already covered the full photo list before the contact-sheet feature existed.

Threat model reminder: this is a local, no-auth, single-user app bound to
127.0.0.1 (see [[csrf-model]]) — "DoS" here is a robustness/quality question
(does it crash on a huge library?), not an attacker-driven resource-exhaustion
scenario, since there's no adversarial multi-tenant boundary.
