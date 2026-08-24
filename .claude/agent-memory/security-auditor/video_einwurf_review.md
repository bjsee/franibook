---
name: video-einwurf-review
description: Security review of video-einwurf branch (ffmpeg standbild extraction, QR video links, video content-type parser) — what's clean and the one real finding
metadata:
  type: project
---

Reviewed the `video-einwurf` branch (apps/server/src/video.ts, project/video.ts,
routes/videos.ts; packages/core/src/model/video.ts, render/qr.ts;
apps/web/src/spread/Videoverweis.tsx/VideoWahl.tsx) on 2026-08-17.

**Clean, verified by reading the code (not just docs):**

- ffmpeg/ffprobe command injection: not exploitable. `execFile` with argument
  arrays (no shell) everywhere; the `-ss` seconds value is validated as
  `Number.isFinite && >= 0` both at the route (`leseSekunde` in routes/videos.ts)
  and again in `standbild()` (video.ts:255) before `String(wann)` — an attacker
  cannot smuggle a flag like `-f` because a non-numeric string becomes `NaN` and
  is rejected upstream. The video file path passed to ffmpeg/ffprobe is always
  server-constructed (`cacheDir/videos/<6-hex-kennung><whitelisted-ext>`), never
  attacker-supplied text.
- Path traversal via video kennung: `istVideoKennung` (packages/core/src/model/video.ts:37)
  enforces `^[0-9a-f]{6}$` and is checked at every point a kennung becomes a path
  component (`findeVideo` in video.ts:145, `standbildEinwerfen` in project/video.ts:90).
  `standbildName()`'s output additionally always goes through `pruefeName`'s
  `basename()` in project/einwurf.ts before touching the filesystem.
- Address validation (`istVideoAdresse`, packages/core/src/model/video.ts:60):
  regex `^https?:\/\/[^\s/?#:]+(:\d+)?([/?#][^\s]*)?$` blocks `javascript:`,
  `data:`, `file:`, and bare paths (has tests). Because the character classes
  exclude `\s` (which includes `\n`/`\r`) everywhere, **no embedded newline can
  ever pass validation** — this closes the `_redirects` line-injection vector
  (`GET /api/videos/umleitungen?format=redirects`, routes/videos.ts:227) even
  though the code doesn't explicitly special-case CRLF. Validated redundantly at
  write (`adresseSetzen`), and again at every read site that prints it
  (`videoQrText`, `videoUmleitungen`) — good defense in depth.
- `Videoverweis.tsx:68` renders the link with `target="_blank" rel="noreferrer noopener"`
  — both attributes present, tab-nabbing covered. The `href` is always bound to
  server-confirmed `verweis.url` (already passed `istVideoAdresse` server-side),
  never to the live unsaved input state.
- No SSRF: the server itself never fetches the stored video address anywhere;
  it's only stored, printed into a QR code, and returned/listed as text.
- VIDEO_MAX_BYTES (video.ts:52) is enforced by manually counting bytes while
  streaming to disk and destroying the source stream on overrun — this is
  necessary and correct given `Content-Length` isn't guaranteed on a raw-stream
  upload; matches the project's own documented threat model (127.0.0.1-only, no
  auth) which explicitly says this limit isn't an attack defense.

**One real (but low-impact-in-context) finding, worth relaying to the user:**
The new video content-type parser (`apps/server/src/app.ts`, registered right
after the image parser, ~line 103) is added to the **top-level `app` instance**,
so it applies **globally to every route**, not just `/api/videos` — Fastify
dispatches content-type parsers purely by `Content-Type` header, not by URL.
A request to _any_ other POST/PUT/PATCH route sent with
`Content-Type: video/mp4` (or the other 3 video mimetypes) gets `req.raw` (the
raw stream) as `req.body` instead of the parsed JSON/Buffer that route expects —
bypassing that route's own `bodyLimit`/parser size guard. Practical impact
turned out to be low: (a) routes that expect a Buffer defensively check
`Buffer.isBuffer(body)` (`leseEinwurf`, routes/kontext.ts:76) and reject
cleanly with 400; (b) JSON routes just see `undefined` properties on the stream
object and fail their own field-presence checks; (c) an unconsumed Node stream
doesn't buffer into process memory (OS-level backpressure), so no real DoS;
(d) cross-origin exploitation from a malicious _webpage_ is additionally
blocked because `video/mp4` isn't a CORS-safelisted content-type, so the
browser requires a preflight the server doesn't answer. Worth a one-line
mention (scope the parser via `fastify.register` encapsulation if they ever
add auth or expose beyond localhost) but not something to block on.

Relates to [[server_video_hosting_model]] (if that gets written) and to the
existing [[query_type_confusion]] pattern of missing Fastify schema validation
— same root cause (no request schemas), different manifestation.
