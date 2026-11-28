// Pattern tools of the Fabric workspace: Your motifs (saved, shared by all projects), opacity and offset, a list of the
// pattern's colours (hide or recolour each) and Match garment colours with suggested colourways.
// Everything is stored on the fabric's `pattern` (optional fields), so the 2D chart, the 3D cloth and the tech pack
// read the same values through patternTile.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FabricPattern } from '../data/fabrics';
import { fabricHex } from '../data/fabrics';
import type { Project } from '../store';
import { withPatternDefaults, patternTile } from '../data/patterns';
import { applyColourEdits, colourways, isHidden, matchPalette, patternColours, quantizePalette, type Bitmap } from '../data/patternFx';
import { ColorField, Switch } from './controls';
import Icon from './Icon';
import { PALETTE, customPatternUrl, svgUrl } from './editHelpers';
import { deleteMotif, listMotifs, renameMotif, saveMotif, MOTIF_MAX_CHARS, type SavedMotif } from './motifLibrary';

const HEX = /^#[0-9a-f]{6}$/i;
const norm = (h: string) => (h.length === 4 ? '#' + h.slice(1).split('').map((c) => c + c).join('') : h).toLowerCase();

/* ---------------------------------------------------------------- pictures */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = url; });
}
async function bitmapOf(url: string, maxPx = 1024): Promise<Bitmap & { data: Uint8ClampedArray }> {
  const im = await loadImage(url);
  const k = Math.min(1, maxPx / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { w: c.width, h: c.height, data: d.data };
}
function pngOf(b: Bitmap): string {
  const c = document.createElement('canvas');
  c.width = b.w; c.height = b.h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.data as Uint8ClampedArray), b.w, b.h), 0, 0);
  return c.toDataURL('image/png');
}
/** The motif picture shrunk until it is under about 1 MB (a saved motif must fit the library). */
export async function shrinkMotifImage(url: string, maxChars = MOTIF_MAX_CHARS * 0.85): Promise<string> {
  if (url.length <= maxChars) return url;
  const im = await loadImage(url);
  let k = Math.sqrt(maxChars / url.length) * 0.9;
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = Math.max(16, Math.round(im.naturalWidth * k)); c.height = Math.max(16, Math.round(im.naturalHeight * k));
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/png');
    if (out.length <= maxChars) return out;
    k *= 0.75;
  }
  return url;
}

/* ---------------------------------------------------------------- the garment's colours */

/** Colours of the garment, main cloth first: pieces (both faces), collar and trims, bands, edge trims, attachments. */
export function garmentPalette(project: Project): string[] {
  const count = new Map<string, number>();
  const add = (h: string | undefined, w = 1) => { if (h && HEX.test(norm(h))) count.set(norm(h), (count.get(norm(h)) ?? 0) + w); };
  for (const p of project.pieces) add(fabricHex(p.fabric), 3);
  const e = project.edits;
  for (const f of Object.values(e?.insideFabric ?? {})) add(fabricHex(f));
  for (const b of e?.bands ?? []) for (const s of b.stripes) add(s.color);
  for (const t of e?.edgeTrims ?? []) add(t.colour);
  for (const a of e?.attachments ?? []) { if (a.fabric) add(fabricHex(a.fabric)); add(a.thread); }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
}

/* ---------------------------------------------------------------- colour edits */

type Setter = (p: FabricPattern) => void;

/** Apply new colours (in patternColours order) and, for a picture motif, redraw the picture from its source. */
async function withColours(cur: FabricPattern, hexes: string[], hidden: number[]): Promise<FabricPattern> {
  const out: FabricPattern = { ...cur };
  if (hidden.length) out.hidden = hidden; else delete out.hidden;
  if (cur.id !== 'custom') { out.colors = [cur.colors[0], ...hexes]; return out; }
  const base = cur.motif?.palette ?? [...new Set((cur.motif?.paths ?? []).map((q) => q.color))];
  out.recolor = base.map((b, i) => hexes[i] ?? b);
  if (cur.motif && !cur.motif.paths?.length && cur.motif.palette && (cur.motif.source ?? cur.motif.image)) {
    const src = cur.motif.source ?? cur.motif.image!;
    const bm = await bitmapOf(src);
    const same = out.recolor.every((c, i) => c.toLowerCase() === base[i].toLowerCase());
    out.motif = { ...cur.motif, source: src, image: same && !hidden.length ? src : pngOf(applyColourEdits(bm, base, hidden, same ? [] : out.recolor)) };
    if (same && !hidden.length) { delete out.motif.source; delete out.recolor; }
  }
  return out;
}

export function PatternColours({ cur, set, project }: { cur: FabricPattern; set: Setter; project: Project }) {
  const cols = patternColours(cur);
  const palette = useMemo(() => garmentPalette(project), [project]);
  const [busy, setBusy] = useState(false);
  const ground = cur.colors[0];
  const hexes = cols.map((c) => c.hex);
  const hidden = cur.hidden ?? [];
  // a picture motif needs its colour list once
  const tried = useRef<string>('');
  useEffect(() => {
    const m = cur.motif;
    if (cur.id !== 'custom' || !m?.image || m.paths?.length || m.palette) return;
    const key = m.image.slice(-40) + m.image.length;
    if (tried.current === key) return;
    tried.current = key;
    void bitmapOf(m.source ?? m.image).then((bm) => { const pal = quantizePalette(bm, 8); if (pal.length) set({ ...cur, motif: { ...m, palette: pal } }); }).catch(() => undefined);
  }, [cur, set]);

  const go = async (nextHex: string[], nextHidden: number[]) => {
    setBusy(true);
    try { set(await withColours(cur, nextHex, nextHidden)); } catch { /* keep as is */ }
    setBusy(false);
  };
  const change = (k: number, hex: string) => void go(hexes.map((h, j) => (j === k ? hex : h)), hidden);
  const toggle = (k: number, off: boolean) => { const idx = cols[k].index; void go(hexes, off ? [...hidden, idx] : hidden.filter((i) => i !== idx)); };
  // colours to replace for Match: the visible ones; the ground stays the cloth colour
  const mine = palette.filter((h) => h !== norm(ground));
  const ways = useMemo(() => (cols.length && mine.length ? colourways(hexes, mine.length ? mine : palette) : []), [hexes.join(), mine.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cols.length) return cur.id === 'custom' ? <p className="group-note" style={{ padding: 0 }}>Reading the colours of your motif.</p> : null;
  const tileOf = (colors: string[]) => {
    if (cur.id === 'custom') return null;
    return patternTile(withPatternDefaults({ ...cur, colors: [ground, ...colors], hidden: undefined, opacity: undefined }));
  };
  return (
    <div className="pt-colours" role="group" aria-label="Colours of this pattern">
      <div className="sublabel">Colours of this pattern</div>
      {cols.map((c, k) => {
        const off = isHidden(cur, c.index);
        const label = `Colour ${k + 1}`;
        return (
          <div className="pt-row" key={c.index}>
            <div className="pt-row-head">
              <span className="pt-chip" style={{ background: c.hex }} aria-hidden="true" />
              <span className="lbl">{label}{off ? ', hidden' : ''}</span>
              <span className="spacer" />
              <span className="pt-hide">Hide<Switch on={off} onChange={(v) => toggle(k, v)} label={`Hide ${label}, ${c.hex}`} /></span>
            </div>
            {!off && <ColorField label={label} value={c.hex} colors={PALETTE} onChange={(hex) => change(k, hex)} />}
          </div>
        );
      })}
      {busy && <p className="group-note" role="status" style={{ padding: 0 }}>Updating the picture.</p>}
      {mine.length > 0 && (
        <>
          <div className="sublabel">Match the garment</div>
          <button className="btn wide" onClick={() => void go(matchPalette(hexes, mine), hidden)}><Icon name="sparkle" size={16} /> Match garment colours</button>
          <p className="group-note" style={{ padding: 0 }}>Uses the cloth, trim, band and edge colours of this garment. The darkest pattern colour gets the darkest garment colour, so the contrast stays.</p>
          <div className="pt-ways" role="list" aria-label="Suggested colourways">
            {ways.map((w) => {
              const t = tileOf(w.colors);
              return (
                <button key={w.id} role="listitem" className="pt-way" onClick={() => void go(w.colors, hidden)} aria-label={`Colourway ${w.name}`}>
                  <span className="pt-way-prev" style={t ? { backgroundImage: svgUrl(t.svg), backgroundSize: `${Math.min(30, 40 / Math.max(1, t.size[0] / 3))}px auto` } : { background: ground }}>
                    {!t && w.colors.map((x, i) => <i key={i} style={{ background: x }} />)}
                  </span>
                  <span className="fb-name">{w.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- opacity and offset */

export function PatternAdjust({ cur, set, idKey }: { cur: FabricPattern; set: Setter; idKey: string }) {
  const pct = Math.round((cur.opacity ?? 1) * 100);
  const rep = Math.max(1, Math.round(cur.scale * 10) / 10);
  const upd = (patch: Partial<FabricPattern>) => set(withPatternDefaults({ ...cur, ...patch }));
  return (
    <>
      <div className="frow stack">
        <label htmlFor={`pat-op-${idKey}`}>Opacity <b className="val">{pct}%</b></label>
        <input id={`pat-op-${idKey}`} type="range" min={0} max={100} step={5} value={pct} onChange={(e) => upd({ opacity: Number(e.target.value) / 100 })} />
      </div>
      <div className="frow stack">
        <label htmlFor={`pat-ox-${idKey}`}>Move sideways <b className="val">{Math.round((cur.offsetX ?? 0) * 10) / 10} cm</b></label>
        <input id={`pat-ox-${idKey}`} type="range" min={-rep} max={rep} step={0.1} value={cur.offsetX ?? 0} onChange={(e) => upd({ offsetX: Number(e.target.value) })} />
      </div>
      <div className="frow stack">
        <label htmlFor={`pat-oy-${idKey}`}>Move up or down <b className="val">{Math.round((cur.offsetY ?? 0) * 10) / 10} cm</b></label>
        <input id={`pat-oy-${idKey}`} type="range" min={-rep} max={rep} step={0.1} value={cur.offsetY ?? 0} onChange={(e) => upd({ offsetY: Number(e.target.value) })} />
      </div>
      {(pct < 100 || cur.offsetX || cur.offsetY) && <button className="btn small" onClick={() => upd({ opacity: 1, offsetX: 0, offsetY: 0 })}>Reset opacity and position</button>}
    </>
  );
}

/* ---------------------------------------------------------------- Your motifs */

export function YourMotifs({ cur, ground, fabricId, onApply }: { cur: FabricPattern | null; ground: string; fabricId: string; onApply: (p: FabricPattern) => void }) {
  const [list, setList] = useState<SavedMotif[]>(() => listMotifs());
  const [msg, setMsg] = useState<string | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const canSave = cur?.id === 'custom' && !!cur.motif;
  const save = async () => {
    if (!cur?.motif) return;
    setMsg(null);
    let motif = cur.motif;
    if (motif.image) { try { motif = { ...motif, image: await shrinkMotifImage(motif.image) }; } catch { /* keep */ } }
    const r = saveMotif(name || `Motif ${list.length + 1}`, { ...cur, motif });
    if (r.ok) { setList(listMotifs()); setName(''); setMsg('Saved to Your motifs.'); } else setMsg(r.message);
  };
  if (!list.length && !canSave) return null;
  return (
    <section className="pt-motifs" aria-label="Your motifs">
      <div className="sublabel">Your motifs</div>
      {list.length > 0 && (
        <div className="pt-motif-row" role="list">
          {list.map((m) => (
            <div className="pt-motif" role="listitem" key={m.id}>
              <button className="pat-tile" aria-label={`Use ${m.name}`} title={`Use ${m.name}`} onClick={() => onApply({ ...m.pattern, colors: [ground, ...m.pattern.colors.slice(1)] })}>
                <span className="pat-prev" style={{ backgroundImage: `url(${customPatternUrl(m.pattern, fabricId, ground, 56)})`, backgroundSize: 'cover' }} />
              </button>
              {rename?.id === m.id ? (
                <input className="txt" aria-label={`Rename ${m.name}`} autoFocus value={rename.name} maxLength={60} onChange={(e) => setRename({ id: m.id, name: e.target.value })}
                  onBlur={() => { const e = renameMotif(m.id, rename.name); setMsg(e); setList(listMotifs()); setRename(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRename(null); }} />
              ) : <span className="fb-name">{m.name}</span>}
              <span className="pt-motif-act">
                <button className="icon-btn" aria-label={`Rename ${m.name}`} title="Rename" onClick={() => setRename({ id: m.id, name: m.name })}><Icon name="pen" size={14} /></button>
                <button className="icon-btn" aria-label={`Delete ${m.name}`} title="Delete" onClick={() => { deleteMotif(m.id); setList(listMotifs()); }}><Icon name="trash" size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
      {canSave && (
        <div className="pt-save">
          <input className="txt" aria-label="Name for this motif" placeholder={`Motif ${list.length + 1}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={() => void save()}><Icon name="plus" size={16} /> Save this motif</button>
        </div>
      )}
      {msg && <p className="group-note" role="status" style={{ padding: 0 }}>{msg}</p>}
    </section>
  );
}
