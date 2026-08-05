/**
 * Alles zum ausgewählten Bild.
 *
 * Vorher stand das als Reihe von zwölf Knöpfen in einer Werkzeugleiste, die je
 * nach Auswahl umsprang. Als Spalte lässt sich dieselbe Menge Griffe nach
 * Fragen ordnen: *Was ist das für ein Bild?* (Datei, Datum, Ort, Auflösung),
 * *was sieht man davon?* (Ausschnitt), *wo steht es?* (Kasten), *wie liegt es?*
 * (Neigung), *soll es weg?* — und die Auflösung bekommt dabei den Platz, den
 * sie braucht, weil sie in diesem Bestand die häufigste Ursache für eine
 * Änderung ist.
 */
import { FRAMES, photoPixelsOf } from '@franibook/core';
import { B, T, dpiFarbe } from '../theme.js';
import { Bilddaten } from './Bilddaten.js';
import { DATUMSQUELLE, zeitpunkt } from './SpreadStage.js';
import { ZOOM_SCHRITT, type SpreadEditorModel } from './useSpreadEditor.js';

export function BildPanel({ model }: { model: SpreadEditorModel }) {
  const {
    gewaehlteBox: box,
    minDpi,
    targetDpi,
    infoVon,
    ausschnittHinweis,
    kastenHinweis,
    istFreiGesetzt,
    aktuelleNeigung,
    neigungGesperrt,
    aktuellerRahmen,
    rahmenEigen,
    rahmenGesperrt,
  } = model;

  if (!box) return null;

  const info = infoVon(box.photoId);
  const dpi = Math.round(box.effectiveDpi);
  const farbe = dpiFarbe(dpi, minDpi, targetDpi);

  return (
    <>
      <div style={{ ...B.abschnitt, gap: 4 }}>
        <div style={S.kopfzeile}>
          <strong style={{ ...B.titel, ...S.name }}>
            {info?.fileName ?? `Slot ${box.slotId}`}
          </strong>
          <button onClick={model.auswahlAufheben} style={S.esc} title="Auswahl aufheben">
            Esc
          </button>
        </div>
        <p style={B.leise}>
          {info ? (zeitpunkt(info) ?? 'ohne Datum') : '…'}
          {info && info.dateSource !== 'exif' && (
            <span style={S.quelle}>{DATUMSQUELLE[info.dateSource] ?? info.dateSource}</span>
          )}
          <br />
          {info?.place?.label ?? 'ohne Ortsangabe'}
          {info?.camera && ` · ${info.camera}`}
        </p>
        <Bilddaten model={model} />

        {/*
          Der Balken misst gegen die Zielauflösung, die Marke steht an der
          Mindestauflösung. Zwei Zahlen also, und beide gehören sichtbar hin: Bei
          30 × 30 cm liegt ein großer Teil dieses Bestands zwischen ihnen, und
          dort ist die Frage nicht „geht es?", sondern „wie knapp?".
        */}
        <div style={S.balkenZeile}>
          <span style={{ ...B.zahl, fontSize: 17, color: farbe }}>{dpi} dpi</span>
          <span style={S.balken}>
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                borderRadius: 2,
                width: `${Math.min(100, (dpi / targetDpi) * 100)}%`,
                background: farbe,
              }}
            />
            <span
              title={`Mindestauflösung ${minDpi} dpi`}
              style={{
                position: 'absolute',
                left: `${(minDpi / targetDpi) * 100}%`,
                top: -2,
                bottom: -2,
                width: 1,
                background: T.fg1,
              }}
            />
          </span>
          <span style={{ fontSize: 11, color: T.fg3 }}>Ziel {targetDpi}</span>
        </div>
        <p style={B.leiser}>
          {dpi < minDpi
            ? 'Zu klein für diesen Platz — im Druck sichtbar unscharf.'
            : dpi < targetDpi
              ? 'Reicht für den Druck, bleibt aber unter der Zielauflösung.'
              : 'Reicht für den Druck.'}
        </p>
        <MaxFlaeche model={model} />
        <LageWarnung model={model} />
      </div>

      {/*
        Beide Paare stehen nebeneinander, seit es keinen Umschalter mehr gibt:
        Was das Ziehen bewegt, entscheidet am Bild der Ort des Griffs — innen
        der Ausschnitt, am Rand der Kasten. Ein Segmentknopf hier wäre der
        zweite Weg zu derselben Wahl und stünde bald quer zu dem, was die Hand
        gerade tut. Die Knopfpaare bleiben trotzdem verschieden benannt: Beim
        Ausschnitt heißt „näher" mehr Zoom im gleichen Kasten, beim Kasten heißt
        „größer" mehr Platz auf der Seite.
      */}
      <div style={B.abschnitt}>
        <span style={B.marke}>Ausschnitt · im Bild ziehen</span>
        <div style={S.paar}>
          <button onClick={() => model.zoomen(ZOOM_SCHRITT)} style={S.halb}>
            Näher <kbd>+</kbd>
          </button>
          <button onClick={() => model.zoomen(1 / ZOOM_SCHRITT)} style={S.halb}>
            Weiter <kbd>−</kbd>
          </button>
        </div>
        <div style={S.hinweisZeile}>
          <span style={B.leise}>{ausschnittHinweis}</span>
          <button
            onClick={() => void model.ausschnittZuruecksetzen()}
            style={B.knopfKlein}
            title="Ausschnitt wieder von der Engine bestimmen lassen"
          >
            automatisch
          </button>
        </div>
      </div>

      <div style={B.abschnitt}>
        <span style={B.marke}>Kasten · am Rand ziehen</span>
        <div style={S.paar}>
          <button onClick={() => void model.groesseAendern(1 / ZOOM_SCHRITT)} style={S.halb}>
            Größer
          </button>
          <button onClick={() => void model.groesseAendern(ZOOM_SCHRITT)} style={S.halb}>
            Kleiner
          </button>
        </div>
        <div style={S.hinweisZeile}>
          <span style={B.leise}>{kastenHinweis}</span>
          <button
            onClick={() => void model.insRaster()}
            disabled={!istFreiGesetzt}
            style={{ ...B.knopfKlein, ...(istFreiGesetzt ? {} : S.aus) }}
            title="Zurück auf den Platz aus der Vorlage"
          >
            ins Raster
          </button>
        </div>
      </div>

      {/*
        Der Rahmen steht zwischen Lage und Neigung, weil er zu beiden gehört: Er
        verkleinert das Bild in seinem Kasten wie die Position und dreht mit ihm
        wie die Neigung. Und er gehört sichtbar hierher und nicht ins Buchpanel
        allein — die Vorgabe gilt fürs ganze Buch, aber die Ausnahme trifft man
        an dem einen Bild, das sie braucht.
      */}
      <div style={B.abschnitt}>
        <div style={S.kopfzeile}>
          <span style={B.marke}>Rahmen</span>
          {rahmenEigen && !rahmenGesperrt && (
            <button
              onClick={() => void model.rahmenWaehlen(null)}
              style={B.knopfKlein}
              title="Wieder dem Rahmen des Buches folgen"
            >
              wie das Buch
            </button>
          )}
        </div>
        {rahmenGesperrt ? (
          <p style={B.leiser}>
            Randabfallend und deshalb ohne Rahmen — ein Karton über der Beschnittkante wird
            abgeschnitten.
          </p>
        ) : (
          <>
            <div style={S.rahmenGitter}>
              {FRAMES.map((f) => (
                <button
                  key={f.id}
                  onClick={() => void model.rahmenWaehlen(f.id)}
                  style={aktuellerRahmen === f.id ? S.rahmenAn : S.rahmenAus}
                  title={f.hinweis}
                >
                  {f.name}
                </button>
              ))}
            </div>
            <p style={B.leiser}>
              {FRAMES.find((f) => f.id === aktuellerRahmen)?.hinweis}
              {!rahmenEigen && aktuellerRahmen !== 'keiner' && ' Kommt aus der Buchvorgabe.'}
            </p>

            {/*
              Das Feld steht auch dann da, wenn der Rahmen keinen Fuß hat — nur
              abgeblendet und begründet, wie der Neigungsregler am Papierrand.
              Ein Feld, das beim Rahmenwechsel verschwindet, ließe den
              gespeicherten Satz wie gelöscht aussehen.
            */}
            <label style={S.unterschriftZeile}>
              <span style={B.marke}>Unterschrift</span>
              <input
                type="text"
                value={model.unterschrift}
                onChange={(e) => model.setPendingCaption(e.target.value)}
                placeholder={model.unterschriftSichtbar ? 'Sylt, Juli 2015' : '—'}
                disabled={!model.unterschriftSichtbar}
                style={{
                  ...B.feld,
                  ...(model.unterschriftSichtbar ? {} : { color: T.fg4 }),
                }}
                title="Steht in Handschrift im Fuß des Sofortbilds"
              />
            </label>
            {!model.unterschriftSichtbar && (
              <p style={B.leiser}>
                {model.unterschrift
                  ? 'Gespeichert, aber unsichtbar: Nur das Polaroid hat einen Fuß, in dem sie stehen kann.'
                  : 'Nur das Polaroid hat einen Fuß, in dem eine Unterschrift stehen kann.'}
              </p>
            )}
          </>
        )}
      </div>

      <div style={B.abschnitt}>
        <div style={S.kopfzeile}>
          <span style={B.marke}>Neigung</span>
          <span style={{ ...B.zahl, fontSize: 15, fontWeight: 500 }}>
            {neigungGesperrt ? '0,0°' : `${aktuelleNeigung.toFixed(1).replace('.', ',')}°`}
          </span>
        </div>
        {/*
          Am Papierrand entfällt der Regler nicht, sondern wird abgeblendet und
          begründet: Ein fehlendes Bedienelement liest sich als Fehler, ein
          abgeblendetes als Regel.
        */}
        <input
          type="range"
          min={-model.neigungGrenze}
          max={model.neigungGrenze}
          step={0.1}
          value={neigungGesperrt ? 0 : aktuelleNeigung}
          disabled={neigungGesperrt}
          onChange={(e) => model.setPendingTilt(Number(e.target.value))}
          style={{ width: '100%' }}
          title="Wie schief das Bild auf der Seite liegt"
        />
        {neigungGesperrt ? (
          <p style={B.leiser}>
            Randabfallend und deshalb gerade — geneigt entstünden weiße Zwickel an der Papierkante.
          </p>
        ) : (
          <div style={S.paar}>
            <button
              onClick={() => model.setPendingTilt(0)}
              style={{ ...S.halb, fontSize: 12 }}
              title="Dieses Bild geradestellen"
            >
              gerade
            </button>
            <button
              onClick={() => void model.neigungZuruecksetzen()}
              style={{ ...S.halb, fontSize: 12 }}
              title="Winkel wieder aus dem Seed bestimmen lassen"
            >
              automatisch
            </button>
          </div>
        )}
      </div>

      {/*
        Die beiden untereinander und nur eines davon rot: Sie sind leicht zu
        verwechseln, und nur eines von beiden fasst die Datei an. Deshalb steht
        die Folge in der Beschriftung, nicht im Tooltip.
      */}
      <div style={{ ...B.abschnitt, borderBottom: 'none', gap: 8 }}>
        <button onClick={() => void model.ausDemBuch()} style={S.breit}>
          Aus dem Buch nehmen — geht in den Fotopool
        </button>
        <button
          onClick={() => void model.loeschen(box.photoId, model.dateiname(box.photoId), true)}
          style={{ ...S.breit, ...B.knopfWeg, textAlign: 'left' }}
          title="Legt die Datei in den Papierkorb ihrer Bildquelle. Der Platz im Buch bleibt leer."
        >
          Foto aussortieren — in den Papierkorb
        </button>
        <p style={B.leiser}>
          Pfeiltasten justieren fein, mit <kbd>⇧</kbd> gröber. <kbd>0</kbd> setzt den Ausschnitt
          zurück, <kbd>Esc</kbd> hebt die Auswahl auf.
        </p>
      </div>
    </>
  );
}

/**
 * Bis zu welcher Fläche dieses Bild noch die Mindestauflösung hält.
 *
 * Die nützlichere Auskunft als „zu klein": Sie sagt nicht, dass es nicht passt,
 * sondern wohin es passen würde — und damit, ob ein kleinerer Platz in einer
 * anderen Vorlage die Lösung ist.
 */
function MaxFlaeche({ model }: { model: SpreadEditorModel }) {
  const box = model.gewaehlteBox;
  if (!box) return null;
  const px = photoPixelsOf(box);
  if (!px) return null;

  const knapp = box.effectiveDpi < model.targetDpi;
  const traegt = `${Math.round((px.width / model.minDpi) * 25.4)} × ${Math.round((px.height / model.minDpi) * 25.4)} mm`;
  const jetzt = `${Math.round(box.wMm)} × ${Math.round(box.hMm)} mm`;

  return (
    <p style={knapp ? S.maxKnapp : S.max}>
      Trägt bis {traegt}. Steht hier {jetzt}.
    </p>
  );
}

/**
 * Bild und Platz stehen quer zueinander.
 *
 * Der Hinweis, der bisher fehlte: Der Ausschnitt hat immer die Form des
 * Platzes, also sitzt der Zoom bei einem gekippten Bild am Anschlag, lange
 * bevor man das ganze Bild sieht — und nichts sagte, warum. Die Zahl macht es
 * greifbar, der Knopf löst es: Neu angeordnet bekommt das Bild einen Platz
 * seiner Lage.
 */
function LageWarnung({ model }: { model: SpreadEditorModel }) {
  const box = model.gewaehlteBox;
  const warnung = box?.warnings.find((w) => w.code === 'orientation-mismatch');
  if (!warnung || warnung.code !== 'orientation-mismatch') return null;

  const hochkant = box!.wMm < box!.hMm;
  return (
    <div style={S.lage}>
      <p style={{ margin: 0 }}>
        Das Bild steht quer zu seinem Platz –{' '}
        {hochkant ? 'querformatig im Hochformat' : 'hochkant im Querformat'}. Sichtbar sind{' '}
        {Math.round(warnung.sichtbar * 100)} %; weiter herauszoomen geht nicht, ohne es zu
        verzerren.
      </p>
      <button onClick={() => void model.neuAnordnen()} style={B.knopf}>
        Doppelseite neu anordnen
      </button>
    </div>
  );
}

const S = {
  kopfzeile: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  esc: {
    font: 'inherit',
    fontSize: 12,
    color: T.fg3,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  quelle: { marginLeft: 6, color: T.fg3 },
  balkenZeile: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 },
  balken: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: T.line,
    position: 'relative' as const,
  },
  paar: { display: 'flex', gap: 8 },
  halb: {
    flex: 1,
    font: 'inherit',
    fontSize: 13,
    padding: '8px 0',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    cursor: 'pointer',
  },
  breit: {
    font: 'inherit',
    fontSize: 13,
    padding: '9px 12px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg1,
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  hinweisZeile: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  aus: { color: T.fg4, cursor: 'default' },
  // Fünf Rahmen in einem Gitter statt in einer Reihe: Als Segmentleiste wären
  // die Beschriftungen auf vier Zeichen zusammengeschnitten, und „Passepartout"
  // ist nicht abkürzbar, ohne unverständlich zu werden.
  rahmenGitter: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 6,
  },
  // Türkis für die getroffene Wahl – dieselbe Farbregel wie überall in der
  // Oberfläche. Der abgesetzte Rahmen der ausgewählten Kachel ersetzt keine
  // Vorschau des Rahmens: Wie er aussieht, zeigt die Doppelseite selbst.
  rahmenAn: {
    font: 'inherit',
    fontSize: 12,
    padding: '7px 4px',
    border: `1px solid ${T.cyan}`,
    borderRadius: T.rMd,
    background: T.cyanZart,
    color: T.cyanTief,
    fontWeight: 600,
    cursor: 'pointer',
  },
  unterschriftZeile: { display: 'flex', flexDirection: 'column' as const, gap: 4, marginTop: 8 },
  rahmenAus: {
    font: 'inherit',
    fontSize: 12,
    padding: '7px 4px',
    border: `1px solid ${T.line2}`,
    borderRadius: T.rMd,
    background: T.bg1,
    color: T.fg2,
    cursor: 'pointer',
  },
  max: {
    margin: '8px 0 0',
    padding: '7px 9px',
    borderRadius: T.rMd,
    fontSize: 12,
    lineHeight: 1.5,
    background: T.bg3,
    color: T.fg2,
  },
  maxKnapp: {
    margin: '8px 0 0',
    padding: '7px 9px',
    borderRadius: T.rMd,
    fontSize: 12,
    lineHeight: 1.5,
    background: T.warnBg,
    border: `1px solid ${T.warnRand}`,
    color: T.warnText,
  },
  // Dieselbe warnende Fläche wie „zu klein": Beides ist eine Aussage über das
  // Buch und nicht über die Bedienung – Türkis wäre hier falsch.
  lage: {
    margin: '8px 0 0',
    padding: '7px 9px',
    borderRadius: T.rMd,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 12,
    lineHeight: 1.5,
    background: T.warnBg,
    border: `1px solid ${T.warnRand}`,
    color: T.warnText,
  },
} satisfies Record<string, React.CSSProperties>;
