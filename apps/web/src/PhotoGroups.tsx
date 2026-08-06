/**
 * Fotoliste mit Gruppierung.
 *
 * Chronologische Liste mit Mini-Vorschau, Datum und aufgelöstem Ort. Über
 * Mehrfachauswahl lassen sich Fotos zu einer benannten Gruppe zusammenfassen;
 * die Gruppen gliedern später das Buch.
 *
 * Die Automatik schlägt Gruppen anhand der Orte vor – entschieden wird hier.
 *
 * Links die Gruppen, rechts ihre Fotos, und beide scrollen für sich: Bei über
 * sechzig Gruppen und 830 Fotos ist eine gemeinsam scrollende Seite der Grund,
 * warum man die Liste verliert, in der man gerade war.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type FotoInfo as PhotoRow,
  fotosLaden,
  gruppeAendern,
  gruppeErstellen,
  gruppeErweitern,
  gruppeLoeschen,
  type Gruppe as Group,
  gruppenLaden,
  gruppenVerschmelzen,
  gruppenVorschlagen,
  gruppierungAufheben,
} from './api.js';
import { auswahlKlick } from './auswahl.js';
import { B, T } from './theme.js';
import { fotoLoeschen, loeschMeldung } from './deletePhoto.js';

type Filter = { kind: 'all' } | { kind: 'ungrouped' } | { kind: 'group'; id: string };

/**
 * Reihenfolge der Gruppenliste.
 *
 * Bei über sechzig Gruppen ist Wiederfinden das eigentliche Problem: Wer eine
 * Beschriftung im Buch gesehen hat, sucht nach dem Namen; wer beim Blättern
 * etwas ändern will, sucht nach der Stelle. Beides braucht seine Ordnung.
 */
type Sortierung = 'buch' | 'name';

interface Props {
  onChanged: () => void;
  /**
   * Gruppe, die gewählt sein soll – sie steht in der Adresse (`/gruppen/<id>`)
   * und kommt von dort auch beim Sprung aus der Doppelseite und beim Zurück des
   * Browsers.
   */
  focusGroupId?: string | null;
  /**
   * Meldet, welche Gruppe gefiltert ist – `null` heißt: keine.
   *
   * Damit die Adresse nicht lügt: Sie nennt die Gruppe, also muss jeder
   * Filterwechsel dort ankommen, gleich ob er von einem Chip kommt oder aus einer
   * Aktion folgt (nach dem Auflösen einer Gruppe steht die Liste wieder auf
   * „alle").
   */
  onGruppeGewaehlt?: (id: string | null) => void;
  /** Springt zu einer Doppelseite des Buches. */
  onOpenSpread?: (index: number) => void;
  /**
   * Zählt hoch, wenn ein Zurücknehmen den Stand ausgetauscht hat.
   *
   * Steht in der Ladeabhängigkeit, damit die Ansicht neu lädt, ohne neu
   * einzuhängen: Ein `key` an der Ansicht wäre eine Zeile weniger, würfe aber
   * bei jedem Cmd+Z Auswahl, Filter und Scrollstand weg.
   */
  standVersion?: number;
}

export function PhotoGroups({
  onChanged,
  focusGroupId,
  onGruppeGewaehlt,
  onOpenSpread,
  standVersion,
}: Props) {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>(
    focusGroupId ? { kind: 'group', id: focusGroupId } : { kind: 'all' },
  );
  const [sortierung, setSortierung] = useState<Sortierung>('buch');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const lastClicked = useRef<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [frageVorschlag, setFrageVorschlag] = useState(false);

  const load = useCallback(async () => {
    const [p, g] = await Promise.all([fotosLaden(), gruppenLaden()]);
    setPhotos(p.photos);
    setGroups(g.groups);
  }, []);

  useEffect(() => {
    void load();
  }, [load, standVersion]);

  // Ein Sprung aus der Doppelseiten-Ansicht wählt die Gruppe aus, auch wenn
  // diese Ansicht schon offen war – ebenso das Zurück des Browsers.
  useEffect(() => {
    if (focusGroupId) setFilter({ kind: 'group', id: focusGroupId });
  }, [focusGroupId]);

  // …und umgekehrt: Was hier gewählt wird, gehört in die Adresse. Als Effekt und
  // nicht an den fünf Stellen, die `setFilter` aufrufen – vier davon sind Folgen
  // einer Aktion, und eine davon zu vergessen wäre eine Adresse, die etwas
  // anderes behauptet als die Liste zeigt.
  useEffect(() => {
    onGruppeGewaehlt?.(filter.kind === 'group' ? filter.id : null);
  }, [filter, onGruppeGewaehlt]);

  /**
   * Sortiert das Foto aus – die Datei bleibt dabei liegen.
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
    const zug = auswahlKlick(
      selected,
      id,
      e,
      sichtbar.map((p) => p.id),
      lastClicked.current,
    );
    lastClicked.current = zug.anker;
    setSelected(zug.selected);
  }

  /**
   * Eine Änderung an den Gruppen.
   *
   * Jeder dieser Endpunkte antwortet mit der vollständigen Gruppenliste – die
   * Ansicht muss also nichts nachladen und nichts von Hand fortschreiben.
   */
  async function call<T extends { groups: Group[] }>(tun: () => Promise<T>): Promise<T> {
    setBusy('…');
    try {
      const data = await tun();
      setGroups(data.groups);
      onChanged();
      return data;
    } finally {
      setBusy(null);
    }
  }

  async function gruppieren() {
    const titel = prompt(`${selected.size} Fotos gruppieren als:`);
    if (!titel?.trim()) return;
    await call(() => gruppeErstellen(titel.trim(), [...selected]));
    setSelected(new Set());
    setNote(`Gruppe „${titel.trim()}" angelegt`);
  }

  async function vorschlagen(reset = false) {
    setFrageVorschlag(false);
    const data = await call(() => gruppenVorschlagen(reset));
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
    await call(() => gruppeAendern(g.id, { title: titel.trim() }));
  }

  /**
   * Die Gruppen in der gewählten Reihenfolge.
   *
   * Der Server liefert sie chronologisch nach dem frühesten Foto. Das ist fast,
   * aber nicht ganz die Buchreihenfolge: Auftaktseiten und Gruppen, deren Fotos
   * gar nicht im Buch stehen, verschieben sie. Deshalb wird hier nach dem
   * tatsächlichen Platz sortiert – und was nicht im Buch vorkommt, ans Ende.
   */
  const sortierteGruppen = useMemo(() => {
    if (sortierung === 'name') {
      return [...groups].sort((a, b) => a.title.localeCompare(b.title, 'de'));
    }
    return [...groups].sort(
      (a, b) => (a.firstSpreadIndex ?? Infinity) - (b.firstSpreadIndex ?? Infinity),
    );
  }, [groups, sortierung]);

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
      <aside style={S.seite}>
        <div style={S.seiteKopf}>
          <strong style={{ ...B.titel, fontSize: 15 }}>Gruppen</strong>
          <button onClick={() => setFrageVorschlag(true)} disabled={!!busy} style={B.knopfKlein}>
            Vorschlagen
          </button>
        </div>

        {frageVorschlag ? (
          <div style={S.frage}>
            <strong style={{ display: 'block', marginBottom: 4 }}>Vorschläge neu berechnen?</strong>
            <ul style={S.frageListe}>
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
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => void vorschlagen(false)} style={B.knopfPrimaer}>
                Neu berechnen
              </button>
              <button onClick={() => setFrageVorschlag(false)} style={B.knopf}>
                Abbrechen
              </button>
            </div>
            <p style={{ ...B.leiser, marginTop: 10, color: T.warnText }}>
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
                style={B.knopfText}
              >
                ganz von vorn beginnen
              </button>{' '}
              — verwirft auch die von Hand angelegten Gruppen.
            </p>
          </div>
        ) : (
          <p style={{ ...B.leiser, margin: '8px 0 12px' }}>
            Vorschläge entstehen aus den Orten. Häufig besuchte Orte gelten als Alltag und sind
            abgeschaltet — sie gliedern das Buch nicht.
          </p>
        )}

        <button
          onClick={() => setFilter({ kind: 'all' })}
          style={filter.kind === 'all' ? B.filterAn : B.filter}
        >
          <span>Alle Fotos</span>
          <span style={S.zahl}>{photos.length}</span>
        </button>
        <button
          onClick={() => setFilter({ kind: 'ungrouped' })}
          style={filter.kind === 'ungrouped' ? B.filterAn : B.filter}
        >
          <span>Ohne Gruppe</span>
          <span style={S.zahl}>{photos.length - gruppiert}</span>
        </button>

        <div style={S.sortLeiste}>
          <span style={{ ...B.marke, marginRight: 4 }}>Reihenfolge</span>
          {(
            [
              ['buch', 'im Buch'],
              ['name', 'Name'],
            ] as const
          ).map(([wert, text]) => (
            <button
              key={wert}
              onClick={() => setSortierung(wert)}
              style={sortierung === wert ? B.sortAn : B.sortAus}
            >
              {text}
            </button>
          ))}
        </div>

        <div style={S.gruppenListe}>
          {sortierteGruppen.map((g) => (
            <button
              key={g.id}
              onClick={() => setFilter({ kind: 'group', id: g.id })}
              style={filter.kind === 'group' && filter.id === g.id ? B.filterAn : B.filter}
              title={g.reason}
            >
              {/*
                Die Doppelseite vor dem Namen: Sie beantwortet die Frage, mit der
                man in diese Liste kommt – „wo im Buch ist das?" Ein Strich heißt,
                dass kein Foto der Gruppe im Buch steht.
              */}
              <span style={S.spreadNr} title="Erste Doppelseite im Buch">
                {g.firstSpreadIndex === undefined ? '–' : g.firstSpreadIndex + 1}
              </span>
              <span style={{ ...S.gruppenTitel, opacity: g.active ? 1 : 0.5 }}>
                {g.active ? '' : '○ '}
                {g.title}
              </span>
              <span style={S.zahl}>{g.photoIds.length}</span>
            </button>
          ))}
        </div>
      </aside>

      <section style={S.haupt}>
        <div style={S.leiste}>
          <span style={{ ...B.leise, minWidth: '8rem' }}>
            {selected.size > 0 ? `${selected.size} ausgewählt` : `${sichtbar.length} Fotos`}
          </span>

          {selected.size > 0 && (
            <>
              <button onClick={() => void gruppieren()} disabled={!!busy} style={B.knopfPrimaer}>
                Gruppieren …
              </button>
              <button
                onClick={() =>
                  void call(() => gruppierungAufheben([...selected])).then(() =>
                    setSelected(new Set()),
                  )
                }
                disabled={!!busy}
                style={B.knopf}
              >
                Gruppierung lösen
              </button>
              {/* Auswahl einer bestehenden Gruppe zuordnen */}
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  void call(() => gruppeErweitern(id, [...selected])).then(() => {
                    setSelected(new Set());
                    setNote(`${selected.size} Fotos zugeordnet`);
                  });
                }}
                disabled={!!busy}
                style={B.auswahl}
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
                  onClick={() => {
                    const [erstes] = [...selected];
                    if (erstes)
                      void call(() => gruppeAendern(aktiveGruppe.id, { coverPhotoId: erstes }));
                  }}
                  disabled={!!busy}
                  style={B.knopf}
                >
                  Als Hauptbild
                </button>
              )}
              <button onClick={() => setSelected(new Set())} style={B.knopf}>
                Auswahl aufheben
              </button>
            </>
          )}

          <span style={B.dehner} />

          {aktiveGruppe && (
            <>
              {/* Der Rückweg zum Sprung aus der Doppelseiten-Ansicht. */}
              {onOpenSpread && aktiveGruppe.firstSpreadIndex !== undefined && (
                <button
                  onClick={() => onOpenSpread(aktiveGruppe.firstSpreadIndex!)}
                  title={`Doppelseite ${aktiveGruppe.firstSpreadIndex + 1} aufschlagen`}
                  style={B.knopf}
                >
                  Im Buch zeigen
                </button>
              )}
              <button
                onClick={() => void umbenennen(aktiveGruppe)}
                disabled={!!busy}
                style={B.knopf}
              >
                Umbenennen
              </button>
              <label style={B.haken}>
                <input
                  type="checkbox"
                  checked={aktiveGruppe.active}
                  onChange={(e) =>
                    void call(() => gruppeAendern(aktiveGruppe.id, { active: e.target.checked }))
                  }
                  disabled={!!busy}
                />
                gliedert das Buch
              </label>
              {/*
                Dreiwertig, weil die Vorgabe selbst schon eine Regel ist: Ohne
                eigene Angabe folgt die Gruppe `settings.groupOpeners`, das
                seinerseits an den Zeitstrahl gekoppelt sein kann.
              */}
              <select
                value={aktiveGruppe.opener === undefined ? '' : String(aktiveGruppe.opener)}
                onChange={(e) =>
                  void call(() =>
                    gruppeAendern(aktiveGruppe.id, {
                      opener: e.target.value === '' ? null : e.target.value === 'true',
                    }),
                  )
                }
                disabled={!!busy}
                style={B.auswahl}
                title="Auftaktseite für diese Gruppe"
              >
                <option value="">Auftakt: wie Vorgabe</option>
                <option value="true">eigene Seite</option>
                <option value="false">keine</option>
              </select>
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
                  void call(() => gruppenVerschmelzen(aktiveGruppe.id, ziel)).then(() => {
                    setFilter({ kind: 'group', id: ziel });
                    setNote(`„${aktiveGruppe.title}" ging in „${zielTitel}" auf`);
                  });
                }}
                disabled={!!busy}
                style={B.auswahl}
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
                  void call(() => gruppeLoeschen(aktiveGruppe.id)).then(() =>
                    setNote(
                      `„${aktiveGruppe.title}" aufgelöst — die ${aktiveGruppe.photoIds.length} Fotos bleiben, ` +
                        `sind aber nicht mehr gruppiert`,
                    ),
                  );
                  setFilter({ kind: 'all' });
                }}
                disabled={!!busy}
                style={B.knopfWeg}
              >
                Gruppe auflösen
              </button>
            </>
          )}
        </div>

        {note && (
          <p style={S.note}>
            {note}
            <button onClick={() => setNote(null)} style={S.noteZu}>
              ×
            </button>
          </p>
        )}

        <div style={S.liste}>
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
                style={{ ...S.zeile, ...(ausgewaehlt ? S.zeileAn : {}) }}
              >
                <img src={`/api/photos/${p.id}/preview?size=thumb`} alt="" style={S.thumb} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={S.datei}>
                    {p.fileName}
                    {istCover && <span style={S.coverTag}>Hauptbild</span>}
                  </div>
                  <div style={S.meta}>
                    <span style={S.datum}>
                      {p.effectiveDate?.replace('T', ' ').slice(0, 16) ?? '—'}
                    </span>
                    {p.place ? (
                      <span style={S.ort}>{p.place.label}</span>
                    ) : (
                      <span style={{ color: T.fg4 }}>kein Ort</span>
                    )}
                    {p.camera && <span>{p.camera}</span>}
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {p.width}×{p.height}
                    </span>
                  </div>
                </div>
                {g && (
                  <span style={{ ...S.gruppenTag, opacity: g.active ? 1 : 0.5 }}>{g.title}</span>
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
                  style={S.weg}
                >
                  ×
                </button>
              </div>
            );
          })}
          <p style={{ ...B.leiser, margin: '12px 0 24px' }}>
            Klick wählt aus, Umschalt-Klick einen Bereich, Cmd-Klick einzelne dazu. Doppelklick
            vergrößert.
          </p>
        </div>
      </section>

      {grossesBild && (
        <div style={S.overlay} onClick={() => setLightbox(null)}>
          <figure style={S.figur} onClick={(e) => e.stopPropagation()}>
            <img
              src={`/api/photos/${grossesBild.id}/preview`}
              alt={grossesBild.fileName}
              style={S.grossesBild}
            />
            <figcaption style={S.bildunterschrift}>
              <strong style={{ color: '#fff', fontFamily: T.mono, fontSize: 13 }}>
                {grossesBild.fileName}
              </strong>
              <span style={{ color: 'var(--warm-300)', fontSize: 12 }}>
                {grossesBild.effectiveDate?.replace('T', ' ').slice(0, 16) ?? 'kein Datum'}
                {grossesBild.place && ` · ${grossesBild.place.label}`}
                {grossesBild.camera && ` · ${grossesBild.camera}`}
                {` · ${grossesBild.width}×${grossesBild.height}`}
              </span>
              <span style={{ color: 'var(--warm-500)', fontSize: 11 }}>
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
  wrap: { flex: 1, display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', minHeight: 0 },
  seite: {
    background: T.bg1,
    borderRight: `1px solid ${T.line}`,
    overflowY: 'auto' as const,
    padding: '18px 16px',
  },
  seiteKopf: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  zahl: { color: T.fg4, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 400 },
  spreadNr: {
    minWidth: '1.8rem',
    color: T.fg4,
    fontVariantNumeric: 'tabular-nums' as const,
    fontWeight: 400,
    textAlign: 'right' as const,
    flexShrink: 0,
  },
  gruppenTitel: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  sortLeiste: { display: 'flex', alignItems: 'center', gap: 4, margin: '14px 0 6px' },
  gruppenListe: { display: 'flex', flexDirection: 'column' as const, gap: 1 },

  haupt: { minWidth: 0, display: 'flex', flexDirection: 'column' as const },
  leiste: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 20px',
    borderBottom: `1px solid ${T.line}`,
    background: T.bg1,
    flexWrap: 'wrap' as const,
    flexShrink: 0,
  },
  note: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '10px 20px 0',
    padding: '6px 10px',
    fontSize: 13,
    color: T.fg2,
    background: T.bg3,
    borderRadius: T.rMd,
  },
  noteZu: {
    font: 'inherit',
    border: 'none',
    background: 'none',
    color: T.fg3,
    cursor: 'pointer',
    padding: 0,
    marginLeft: 'auto',
  },
  liste: { flex: 1, overflowY: 'auto' as const, padding: '0 20px' },
  zeile: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '8px 10px',
    borderBottom: `1px solid ${T.bg3}`,
    borderRadius: T.rMd,
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  zeileAn: { background: T.cyanZart },
  thumb: {
    width: 60,
    height: 44,
    objectFit: 'cover' as const,
    borderRadius: T.rSm,
    background: T.bg3,
    flexShrink: 0,
  },
  datei: {
    fontFamily: T.mono,
    fontSize: 13,
    color: T.fg1,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  meta: {
    display: 'flex',
    gap: 14,
    fontSize: 12,
    color: T.fg3,
    flexWrap: 'wrap' as const,
    marginTop: 2,
  },
  datum: { fontVariantNumeric: 'tabular-nums' as const, minWidth: '9rem' },
  ort: { color: T.cyanTief },
  gruppenTag: {
    fontSize: 12,
    padding: '3px 10px',
    background: T.bg3,
    borderRadius: T.rPill,
    whiteSpace: 'nowrap' as const,
    color: T.fg2,
  },
  weg: {
    font: 'inherit',
    fontSize: 14,
    lineHeight: 1,
    width: 24,
    height: 24,
    border: `1px solid ${T.fehlerRand}`,
    borderRadius: '50%',
    background: T.bg1,
    color: T.fehler,
    cursor: 'pointer',
    flexShrink: 0,
  },
  coverTag: {
    marginLeft: 8,
    fontSize: 10,
    padding: '1px 6px',
    background: T.warnBg,
    color: T.warnText,
    borderRadius: T.rSm,
    fontFamily: 'inherit',
  },

  frage: {
    padding: '10px 12px',
    margin: '8px 0 12px',
    background: T.warnBg,
    border: `1px solid ${T.warnRand}`,
    borderRadius: T.rLg,
    fontSize: 12,
    lineHeight: 1.5,
  },
  frageListe: { margin: '0 0 10px', paddingLeft: 16, color: T.warnText },

  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(51, 46, 42, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    zIndex: 100,
    cursor: 'zoom-out',
  },
  figur: {
    margin: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
    maxHeight: '100%',
    cursor: 'default',
  },
  grossesBild: {
    maxWidth: '100%',
    maxHeight: 'calc(100vh - 10rem)',
    objectFit: 'contain' as const,
    boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
    background: '#000',
  },
  bildunterschrift: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 3,
    textAlign: 'center' as const,
  },
} satisfies Record<string, React.CSSProperties>;
