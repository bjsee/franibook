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

  async function vorschlagen() {
    const data = await call('/api/groups/suggest', { method: 'POST' });
    setNote(
      data.added > 0
        ? `${data.added} Gruppen vorgeschlagen`
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

  return (
    <div style={S.wrap}>
      <aside style={S.side}>
        <div style={S.sideHead}>
          <strong>Gruppen</strong>
          <button onClick={() => void vorschlagen()} disabled={!!busy} style={S.smallButton}>
            Vorschlagen
          </button>
        </div>
        <p style={S.hint}>
          Vorschläge entstehen aus den Orten. Häufig besuchte Orte gelten als Alltag und sind
          abgeschaltet — sie gliedern das Buch nicht.
        </p>

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
              <button
                onClick={() => {
                  void call(`/api/groups/${aktiveGruppe.id}`, { method: 'DELETE' });
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
              </div>
            );
          })}
        </div>

        <p style={S.hint}>
          Klick wählt aus, Umschalt-Klick einen Bereich, Cmd-Klick einzelne dazu.
        </p>
      </section>
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
  coverTag: {
    marginLeft: '0.5rem',
    fontSize: '0.65rem',
    padding: '0.05rem 0.35rem',
    background: '#fef3c7',
    color: '#92400e',
    borderRadius: '3px',
  },
} satisfies Record<string, React.CSSProperties>;
