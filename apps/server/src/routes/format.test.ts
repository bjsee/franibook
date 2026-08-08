/**
 * Der Formatwechsel ist der einzige Griff, der die Maße des ganzen Buches
 * ändert, ohne es neu zu bauen. Genau diese Kombination wird hier festgehalten:
 * Das Profil wechselt, die Doppelseiten bleiben stehen, und eine Seitenzahl,
 * die im neuen Format nicht mehr zulässig wäre, wird geklemmt statt verschwiegen.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { baueApp } from '../app.js';
import { Project } from '../project.js';
import { Sources } from '../sources.js';
import type { Kontext } from './kontext.js';

async function probe(): Promise<{ app: FastifyInstance; project: Project }> {
  const dir = await mkdtemp(join(tmpdir(), 'franibook-format-'));
  const quelle = join(dir, 'bilder');
  await mkdir(quelle, { recursive: true });
  await writeFile(join(quelle, '2017-03-05.jpg'), 'kein echtes Bild');

  const sources = new Sources();
  const { source } = await sources.add(quelle, 'Probe');
  const project = new Project(sources, null as never, null as never, dir);
  project.photos.set('p0', {
    id: 'p0',
    relPath: '2017-03-05.jpg',
    sourceId: source.id,
    fileName: '2017-03-05.jpg',
    bytes: 2_000_000,
    width: 4000,
    height: 3000,
    orientation: 1,
    takenAt: '2017-03-05T12:00:00',
  });
  project.settings.targetPages = 160;
  project.generate();

  const kontext = {
    project,
    sources,
    previews: null as never,
    decodes: null as never,
    abstaende: null as never,
    outDir: dir,
  } as Kontext;

  const { app } = baueApp({ kontext, anlauf: () => null, logger: false });
  return { app, project };
}

describe('Buchformat wechseln', () => {
  it('setzt das Profil und liefert die neuen Maße', async () => {
    const { app, project } = await probe();
    expect(project.profile.page.trimWidthMm).toBe(270);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/format',
      payload: { printProfileId: 'format-42x28' },
    });

    expect(res.statusCode).toBe(200);
    expect(project.settings.printProfileId).toBe('format-42x28');
    expect(project.profile.page.trimWidthMm).toBe(420);
    expect(project.profile.page.trimHeightMm).toBe(270);
  });

  it('klemmt eine Seitenzahl, die das neue Format nicht hergibt, und sagt es', async () => {
    // 160 Seiten gibt es nur in den drei größten Formaten; 42×28 endet bei 130.
    const { app, project } = await probe();
    expect(project.settings.targetPages).toBe(160);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/format',
      payload: { printProfileId: 'format-42x28' },
    });

    expect(project.settings.targetPages).toBe(130);
    const body = res.json() as { hinweise: string[] };
    expect(body.hinweise.some((h) => h.includes('130'))).toBe(true);
  });

  it('ordnet dabei nichts neu', async () => {
    // Der eigentliche Grund für die eigene Route: Jede Vorlage ist normiert,
    // also übersteht die Aufteilung den Wechsel – und mit ihr jede Handarbeit.
    const { app, project } = await probe();
    const vorher = JSON.stringify(project.spreads);

    await app.inject({
      method: 'PATCH',
      url: '/api/format',
      payload: { printProfileId: 'format-15x15' },
    });

    expect(JSON.stringify(project.spreads)).toBe(vorher);
  });

  it('lehnt eine unbekannte Kennung mit einem Satz ab', async () => {
    const { app, project } = await probe();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/format',
      payload: { printProfileId: 'format-99x99' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain('format-99x99');
    // Und ändert nichts: Ein abgelehnter Wechsel darf kein halbes Format setzen.
    expect(project.settings.printProfileId).toBe('format-28x28');
  });
});
