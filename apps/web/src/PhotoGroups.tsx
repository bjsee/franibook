/**
 * Fotoliste mit Gruppierung.
 *
 * Chronologische Liste mit Mini-Vorschau, Datum und aufgelöstem Ort. Über
 * Mehrfachauswahl lassen sich Fotos zu einer benannten Gruppe zusammenfassen;
 * die Gruppen gliedern später das Buch.
 *
 * Die Automatik schlägt Gruppen anhand der Orte vor – entschieden wird hier.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fotoLoeschen, loeschMeldung } from './deletePhoto.js';

interface PhotoRow {
  id: string;
  fileName: string;
  effectiveDate: string | null;
  dateSource: string;
  place?: { key: string; label: string };
  camera?: string;
  width: number;
  height: number;
}

interface Group {
  id: string;
  title: string;
  photoIds: string[];
  coverPhotoId?: string;
  origin: 'manual' | 'place' | 'calendar';
  active: boolean;
  /** Auftaktseite für diese Gruppe, unabhängig von der Vorgabe. */
  opener?: boolean;
  reason?: string;
}

type Filter = { kind: 'all' } | { kind: 'ungrouped' } | { kind: 'group'; id: string };

export function PhotoGroups({ onChanged }: { onChanged: () => void }) {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const lastClicked = useRef<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [frageVorschlag, setFrageVorschlag] = useState(false);

  const load = useCallback(async () => {
    const [p, g] = await Promise.all([
      fetch('/api/photos').then((r) => r.json()),
      fetch('/api/groups').then((r) => r.json()),
    ]);
    setPhotos(p.photos);
    setGroups(g.groups);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Legt die Datei in den Papierkorb ihrer Quelle.
   *
   * Von hier aus ist nicht erkennbar, ob das Foto im Buch steht – die Liste
   * kennt die Doppelseiten nicht. Die Rückmeldung sagt es hinterher.
   */
  async function aussortieren(id: string, fileName: string) {
    const antwort = await fotoLoeschen(id, { name: fileName });
    if (!antwort) return;
    if (!antwort.ok) {
      setNote(antwort.fehler);
      return;
    }
    setSelected((s) => {
      const neu = new Set(s);
      neu.delete(id);
      return neu;
    });
    await load();
    onChanged();
    setNote(loeschMeldung(antwort.ergebnis));
  }

  const groupOf = useMemo(() => {
    const map = new Map<string, Group>();
    for (const g of groups) for (const id of g.photoIds) map.set(id, g);
    return map;
  }, [groups]);

  const sichtbar = useMemo(() => {
    if (filter.kind === 'all') return photos;
    if (filter.kind === 'ungrouped') return photos.filter((p) => !groupOf.has(p.id));
    const g = groups.find((x) => x.id === filter.id);
    if (!g) return [];
    const order = new Map(g.photoIds.map((id, i) => [id, i]));
    return photos
      .filter((p) => order.has(p.id))
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }, [photos, groups, filter, groupOf]);

  function toggle(id: string, e: React.MouseEvent) {
    const next = new Set(selected);

    if (e.shiftKey && lastClicked.current) {
      // Bereich zwischen der letzten und dieser Zeile
      const von = sichtbar.findIndex((p) => p.id === lastClicked.current);
      const bis = sichtbar.findIndex((p) => p.id === id);
      if (von >= 0 && bis >= 0) {
        for (let i = Math.min(von, bis); i <= Math.max(von, bis); i++) {
          next.add(sichtbar[i]!.id);
        }
      }
    } else if (e.metaKey || e.ctrlKey) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      next.clear();
      next.add(id);
    }

    lastClicked.current = id;
    setSelected(next);
  }

  async function call(url: string, init?: RequestInit) {
    setBusy('…');
    try {
      const res = await fetch(url, {
        ...init,
        ...(init?.body ? { headers: { 'content-type': 'application/json' } } : {}),
      });
      const data = await res.json();
      if (data.groups) setGroups(data.groups);
      onChanged();
      return data;
    } finally {
      setBusy(null);
    }
  }

  async function gruppieren() {
    const titel = prompt(`${selected.size} Fotos gruppieren als:`);
    if (!titel?.trim()) return;
    await call('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ title: titel.trim(), photoIds: [...selected] }),
    });
    setSelected(new Set());
    setNote(`Gruppe „${titel.trim()}" angelegt`);
  }

  async function vorschlagen(reset = false) {
    setFrageVorschlag(false);
    const data = await call('/api/groups/suggest', {
      method: 'POST',
      body: JSON.stringify({ reset }),
    });
    setFilter({ kind: 'all' });
    setNote(
      reset
        ? `Von vorn begonnen: ${data.groups.length} Gruppen vorgeschlagen`
        : data.added > 0
          ? `${data.added} Gruppen hinzugekommen`
          : 'Keine neuen Gruppen gefunden — vorhandene bleiben unverändert',
    );
  }

  async function umbenennen(g: Group) {
    const titel = prompt('Neuer Titel:', g.title);
    if (!titel?.trim() || titel === g.title) return;
    await call(`/api/groups/${g.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: titel.trim() }),
    });
  }

  const aktiveGruppe = filter.kind === 'group' ? groups.find((g) => g.id === filter.id) : undefined;
  const gruppiert = groupOf.size;
  const manuelleGruppen = groups.filter((g) => g.origin === 'manual').length;
  const automatischeGruppen = groups.length - manuelleGruppen;
  const grossesBild = sichtbar.find((p) => p.id === lightbox);

  // Im geöffneten Bild lässt sich blättern, ohne es zu schließen.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = sichtbar.findIndex((p) => p.id === lightbox);
        const next = e.key === 'ArrowRight' ? i + 1 : i - 1;
        if (next >= 0 && next < sichtbar.length) setLightbox(sichtbar[next]!.id);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, sichtbar]);

  return (
    <div style={S.wrap}>
      <aside style={S.side}>
        <div style={S.sideHead}>
          <strong>Gruppen</strong>
          <button onClick={() => setFrageVorschlag(true)} disabled={!!busy} style={S.smallButton}>
            Vorschlagen
          </button>
        </div>
        {frageVorschlag ? (
          <div style={S.confirm}>
            <strong style={S.confirmTitle}>Vorschläge neu berechnen?</strong>
            <ul style={S.confirmList}>
              <li>
                <strong>{manuelleGruppen}</strong> von Hand angelegte oder bearbeitete{' '}
                {manuelleGruppen === 1 ? 'Gruppe bleibt' : 'Gruppen bleiben'} unverändert. Als
                bearbeitet gilt auch Umbenennen, Ab- und Anschalten sowie das Setzen eines
                Hauptbilds.
              </li>
              <li>
                <strong>{automatischeGruppen}</strong> unberührte{' '}
                {automatischeGruppen === 1 ? 'Vorschlagsgruppe wird' : 'Vorschlagsgruppen werden'}{' '}
                neu zugeschnitten. Welche Fotos darin liegen, kann sich ändern; einzelne Gruppen
                können wegfallen oder hinzukommen.
              </li>
            </ul>
            <div style={S.confirmButtons}>
              <button onClick={() => void vorschlagen(false)} style={S.confirmOk}>
                Neu berechnen
              </button>
              <button onClick={() => setFrageVorschlag(false)} style={S.button}>
                Abbrechen
              </button>
            </div>

            <p style={S.confirmReset}>
              Oder{' '}
              <button
                onClick={() => {
                  if (
                    confirm(
                      `Wirklich von vorn beginnen? Alle ${groups.length} Gruppen werden verworfen, ` +
                        `auch die ${manuelleGruppen} von Hand angelegten. Titel, Hauptbilder und ` +
                        `Ein-/Aus-Schalter gehen dabei verloren.`,
                    )
                  ) {
                    void vorschlagen(true);
                  }
                }}
                style={S.linkButton}
              >
                ganz von vorn beginnen
              </button>{' '}
              — verwirft auch die von Hand angelegten Gruppen.
            </p>
          </div>
        ) : (
          <p style={S.hint}>
            Vorschläge entstehen aus den Orten. Häufig besuchte Orte gelten als Alltag und sind
            abgeschaltet — sie gliedern das Buch nicht.
          </p>
        )}

        <button
          onClick={() => setFilter({ kind: 'all' })}
          style={filter.kind === 'all' ? S.filterActive : S.filter}
        >
          Alle Fotos <span style={S.count}>{photos.length}</span>
        </button>
        <button
          onClick={() => setFilter({ kind: 'ungrouped' })}
          style={filter.kind === 'ungrouped' ? S.filterActive : S.filter}
        >
          Ohne Gruppe <span style={S.count}>{photos.length - gruppiert}</span>
        </button>

        <ul style={S.groupList}>
          {groups.map((g) => (
            <li key={g.id}>
              <button
                onClick={() => setFilter({ kind: 'group', id: g.id })}
                style={filter.kind === 'group' && filter.id === g.id ? S.filterActive : S.filter}
                title={g.reason}
              >
                <span style={{ opacity: g.active ? 1 : 0.45 }}>
                  {g.active ? '' : '○ '}
                  {g.title}
                </span>
                <span style={S.count}>{g.photoIds.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section style={S.main}>
        <div style={S.toolbar}>
          <span style={S.muted}>
            {selected.size > 0 ? `${selected.size} ausgewählt` : `${sichtbar.length} Fotos`}
          </span>

          {selected.size > 0 && (
            <>
              <button onClick={() => void gruppieren()} style={S.button}>
                Gruppieren …
              </button>
              <button
                onClick={() =>
                  void call('/api/groups/ungroup', {
                    method: 'POST',
                    body: JSON.stringify({ photoIds: [...selected] }),
                  }).then(() => setSelected(new Set()))
                }
                style={S.button}
              >
                Gruppierung lösen
              </button>
              {/* Auswahl einer bestehenden Gruppe zuordnen */}
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  void call(`/api/groups/${id}/add`, {
                    method: 'POST',
                    body: JSON.stringify({ photoIds: [...selected] }),
                  }).then(() => {
                    setSelected(new Set());
                    setNote(`${selected.size} Fotos zugeordnet`);
                  });
                }}
                style={S.select}
              >
                <option value="">Zu Gruppe hinzufügen …</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title} ({g.photoIds.length})
                  </option>
                ))}
              </select>

              {aktiveGruppe && selected.size === 1 && (
                <button
                  onClick={() =>
                    void call(`/api/groups/${aktiveGruppe.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ coverPhotoId: [...selected][0] }),
                    })
                  }
                  style={S.button}
                >
                  Als Hauptbild
                </button>
              )}
              <button onClick={() => setSelected(new Set())} style={S.button}>
                Auswahl aufheben
              </button>
            </>
          )}

          <span style={S.spacer} />

          {aktiveGruppe && (
            <>
              <button onClick={() => void umbenennen(aktiveGruppe)} style={S.button}>
                Umbenennen
              </button>
              <label style={S.check}>
                <input
                  type="checkbox"
                  checked={aktiveGruppe.active}
                  onChange={(e) =>
                    void call(`/api/groups/${aktiveGruppe.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ active: e.target.checked }),
                    })
                  }
                />
                gliedert das Buch
              </label>
              {/*
                Dreiwertig, weil die Vorgabe selbst schon eine Regel ist: Ohne
                eigene Angabe folgt die Gruppe `settings.groupOpeners`, das
                seinerseits an den Zeitstrahl gekoppelt sein kann.
              */}
              <label style={S.check}>
                Auftakt
                <select
                  value={aktiveGruppe.opener === undefined ? '' : String(aktiveGruppe.opener)}
                  onChange={(e) =>
                    void call(`/api/groups/${aktiveGruppe.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        opener: e.target.value === '' ? null : e.target.value === 'true',
                      }),
                    })
                  }
                >
                  <option value="">wie Vorgabe</option>
                  <option value="true">eigene Seite</option>
                  <option value="false">keine</option>
                </select>
              </label>
              {/*
                Zusammenführen: Die Automatik zerlegt einen Aufenthalt
                gelegentlich in zwei – „Helgoland Mai 2025" und „Helgoland
                Juli 2025" gehören vielleicht doch zusammen.
              */}
              <select
                value=""
                onChange={(e) => {
                  const ziel = e.target.value;
                  if (!ziel) return;
                  const zielTitel = groups.find((g) => g.id === ziel)?.title ?? '';
                  void call(`/api/groups/${aktiveGruppe.id}/merge`, {
                    method: 'POST',
                    body: JSON.stringify({ targetId: ziel }),
                  }).then(() => {
                    setFilter({ kind: 'group', id: ziel });
                    setNote(`„${aktiveGruppe.title}" ging in „${zielTitel}" auf`);
                  });
                }}
                style={S.select}
              >
                <option value="">Zusammenführen mit …</option>
                {groups
                  .filter((g) => g.id !== aktiveGruppe.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title} ({g.photoIds.length})
                    </option>
                  ))}
              </select>

              <button
                onClick={() => {
                  void call(`/api/groups/${aktiveGruppe.id}`, { method: 'DELETE' }).then(() =>
                    setNote(
                      `„${aktiveGruppe.title}" aufgelöst — die ${aktiveGruppe.photoIds.length} Fotos bleiben, ` +
                        `sind aber nicht mehr gruppiert`,
                    ),
                  );
                  setFilter({ kind: 'all' });
                }}
                style={S.button}
              >
                Gruppe auflösen
              </button>
            </>
          )}
        </div>

        {note && <p style={S.note}>{note}</p>}

        <div style={S.list}>
          {sichtbar.map((p) => {
            const g = groupOf.get(p.id);
            const ausgewaehlt = selected.has(p.id);
            const istCover = g?.coverPhotoId === p.id;
            return (
              <div
                key={p.id}
                onClick={(e) => toggle(p.id, e)}
                onDoubleClick={() => setLightbox(p.id)}
                title="Doppelklick vergrößert"
                style={{ ...S.row, ...(ausgewaehlt ? S.rowSelected : {}) }}
              >
                <img src={`/api/photos/${p.id}/preview?size=thumb`} alt="" style={S.thumb} />
                <div style={S.rowMain}>
                  <div style={S.rowFile}>
                    {p.fileName}
                    {istCover && <span style={S.coverTag}>Hauptbild</span>}
                  </div>
                  <div style={S.rowMeta}>
                    <span style={S.date}>
                      {p.effectiveDate?.replace('T', ' ').slice(0, 16) ?? '—'}
                    </span>
                    {p.place ? (
                      <span style={S.place}>{p.place.label}</span>
                    ) : (
                      <span style={S.placeNone}>kein Ort</span>
                    )}
                    {p.camera && <span style={S.camera}>{p.camera}</span>}
                    <span style={S.px}>
                      {p.width}×{p.height}
                    </span>
                  </div>
                </div>
                {g && (
                  <span style={{ ...S.groupTag, opacity: g.active ? 1 : 0.45 }}>{g.title}</span>
                )}
                {/*
                  Hier stehen die Bilder eines Tages untereinander – die Stelle,
                  an der Dubletten auffallen. Deshalb das Aussortieren direkt in
                  der Zeile, mit stopPropagation, damit es die Auswahl nicht
                  umwirft.
                */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void aussortieren(p.id, p.fileName);
                  }}
                  title={`„${p.fileName}" aussortieren`}
                  style={S.rowWeg}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <p style={S.hint}>
          Klick wählt aus, Umschalt-Klick einen Bereich, Cmd-Klick einzelne dazu. Doppelklick
          vergrößert.
        </p>
      </section>

      {grossesBild && (
        <div style={S.overlay} onClick={() => setLightbox(null)}>
          <figure style={S.figure} onClick={(e) => e.stopPropagation()}>
            <img
              src={`/api/photos/${grossesBild.id}/preview`}
              alt={grossesBild.fileName}
              style={S.bigImage}
            />
            <figcaption style={S.figCaption}>
              <strong style={S.captionFile}>{grossesBild.fileName}</strong>
              <span style={S.captionMeta}>
                {grossesBild.effectiveDate?.replace('T', ' ').slice(0, 16) ?? 'kein Datum'}
                {grossesBild.place && ` · ${grossesBild.place.label}`}
                {grossesBild.camera && ` · ${grossesBild.camera}`}
                {` · ${grossesBild.width}×${grossesBild.height}`}
              </span>
              <span style={S.captionHint}>
                Pfeiltasten blättern · Esc oder Klick daneben schließt
              </span>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

const S = {
  wrap: {
    display: 'grid',
    gridTemplateColumns: '260px minmax(0, 1fr)',
    gap: '1.5rem',
    marginTop: '1rem',
  },
  side: { position: 'sticky' as const, top: '1rem', alignSelf: 'start' },
  sideHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '0.4rem',
  },
  hint: { fontSize: '0.72rem', color: '#9ca3af', margin: '0.4rem 0 0.8rem', lineHeight: 1.45 },
  filter: {
    display: 'flex',
    width: '100%',
    justifyContent: 'space-between',
    gap: '0.5rem',
    padding: '0.3rem 0.5rem',
    border: '1px solid transparent',
    borderRadius: '5px',
    background: 'none',
    cursor: 'pointer',
    fontSize: '0.8125rem',
    textAlign: 'left' as const,
  },
  filterActive: {
    display: 'flex',
    width: '100%',
    justifyContent: 'space-between',
    gap: '0.5rem',
    padding: '0.3rem 0.5rem',
    border: '1px solid #bfdbfe',
    borderRadius: '5px',
    background: '#eff6ff',
    cursor: 'pointer',
    fontSize: '0.8125rem',
    fontWeight: 600,
    textAlign: 'left' as const,
  },
  count: { color: '#9ca3af', fontVariantNumeric: 'tabular-nums' as const, fontWeight: 400 },
  groupList: {
    listStyle: 'none',
    margin: '0.5rem 0 0',
    padding: 0,
    maxHeight: '55vh',
    overflowY: 'auto' as const,
  },
  main: { minWidth: 0 },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    paddingBottom: '0.6rem',
    borderBottom: '1px solid #e5e7eb',
    flexWrap: 'wrap' as const,
  },
  spacer: { flex: 1 },
  muted: { color: '#6b7280', fontSize: '0.8125rem', minWidth: '7rem' },
  button: {
    padding: '0.25rem 0.6rem',
    border: '1px solid #d1d5db',
    borderRadius: '5px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.78rem',
  },
  smallButton: {
    padding: '0.15rem 0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '5px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.72rem',
  },
  check: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.78rem',
    color: '#374151',
  },
  note: { fontSize: '0.78rem', color: '#065f46', margin: '0.4rem 0 0' },
  list: { marginTop: '0.5rem', maxHeight: '68vh', overflowY: 'auto' as const },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.3rem 0.5rem',
    borderBottom: '1px solid #f3f4f6',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  rowSelected: { background: '#eff6ff' },
  thumb: {
    width: 56,
    height: 42,
    objectFit: 'cover' as const,
    borderRadius: '3px',
    background: '#f3f4f6',
    flexShrink: 0,
  },
  rowMain: { minWidth: 0, flex: 1 },
  rowFile: {
    fontSize: '0.78rem',
    fontFamily: 'ui-monospace, monospace',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowMeta: {
    display: 'flex',
    gap: '0.75rem',
    fontSize: '0.7rem',
    color: '#6b7280',
    flexWrap: 'wrap' as const,
  },
  date: { fontVariantNumeric: 'tabular-nums' as const, minWidth: '8rem' },
  place: { color: '#0369a1', fontWeight: 500 },
  placeNone: { color: '#d1d5db' },
  camera: { color: '#9ca3af' },
  px: { color: '#9ca3af', fontVariantNumeric: 'tabular-nums' as const },
  groupTag: {
    fontSize: '0.7rem',
    padding: '0.1rem 0.45rem',
    background: '#f3f4f6',
    borderRadius: '4px',
    whiteSpace: 'nowrap' as const,
  },
  rowWeg: {
    font: 'inherit',
    fontSize: '0.9rem',
    lineHeight: 1,
    width: '1.4rem',
    height: '1.4rem',
    border: '1px solid #fca5a5',
    borderRadius: '50%',
    background: '#fff',
    color: '#991b1b',
    cursor: 'pointer',
    flexShrink: 0,
  },
  figCaption: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.2rem',
    textAlign: 'center' as const,
  },
  confirm: {
    padding: '0.6rem 0.7rem',
    margin: '0.4rem 0 0.8rem',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: '6px',
    fontSize: '0.75rem',
    lineHeight: 1.5,
  },
  confirmTitle: { display: 'block', marginBottom: '0.3rem' },
  confirmList: { margin: '0 0 0.5rem', paddingLeft: '1rem', color: '#78350f' },
  confirmButtons: { display: 'flex', gap: '0.4rem' },
  confirmReset: { margin: '0.55rem 0 0', fontSize: '0.7rem', color: '#92400e', lineHeight: 1.45 },
  linkButton: {
    padding: 0,
    border: 'none',
    background: 'none',
    color: '#b45309',
    textDecoration: 'underline',
    cursor: 'pointer',
    font: 'inherit',
  },
  confirmOk: {
    padding: '0.25rem 0.6rem',
    border: '1px solid #b45309',
    borderRadius: '5px',
    background: '#f59e0b',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.78rem',
  },
  select: {
    padding: '0.25rem 0.4rem',
    border: '1px solid #d1d5db',
    borderRadius: '5px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.78rem',
    maxWidth: '13rem',
  },
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(17, 24, 39, 0.88)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    zIndex: 100,
    cursor: 'zoom-out',
  },
  figure: {
    margin: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.75rem',
    maxHeight: '100%',
    cursor: 'default',
  },
  bigImage: {
    maxWidth: '100%',
    maxHeight: 'calc(100vh - 10rem)',
    objectFit: 'contain' as const,
    boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
    background: '#000',
  },
  captionFile: { color: '#fff', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' },
  captionMeta: { color: '#d1d5db', fontSize: '0.78rem' },
  captionHint: { color: '#6b7280', fontSize: '0.7rem' },
  coverTag: {
    marginLeft: '0.5rem',
    fontSize: '0.65rem',
    padding: '0.05rem 0.35rem',
    background: '#fef3c7',
    color: '#92400e',
    borderRadius: '3px',
  },
} satisfies Record<string, React.CSSProperties>;
