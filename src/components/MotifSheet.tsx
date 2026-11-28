// "Your motif": upload or draw a motif (or a photo of a repeating print), recognise it, preview the repeat on the
// fabric with layout, size, spacing, turn, ground, recolour and print method, then apply it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { FabricPattern, PatternMotif, RepeatLayout } from '../data/fabrics';
import type { PieceFabric } from '../data/presets';
import { Sheet } from './Sheets';
import { ColorField, Seg } from './controls';
import Icon from './Icon';
import { LAYOUTS, PALETTE, detectRepeat, drawCustomPattern, extractMotif, fabricHex, prepareImage, suggestLayout, vectoriseMotif, type Bitmap, type RepeatInfo } from './editHelpers';

type Stage = 'start' | 'draw' | 'work';
const PHOTO_CM = 30; // a photo is assumed to cover about 30 cm of cloth until the person says otherwise

/** Preview of the repeat on a canvas. */
function PatternCanvas({ pattern, ground, cm, size, label }: { pattern: FabricPattern; ground: string; cm: number; size: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
    const ctx = c.getContext('2d')!;
    drawCustomPattern(ctx, c.width, c.height, pattern, ground, c.width / cm, () => setTick((n) => n + 1));
  }, [pattern, ground, cm, size, tick]);
  return <canvas ref={ref} role="img" aria-label={label ?? 'Preview'} style={{ width: size, height: size }} />;
}

export default function MotifSheet({ value, onClose, target }: { value: PieceFabric; onClose: () => void; /** where the Fabric panel is dressing: one Apply button instead of the three scopes */ target?: { label: string; apply: (f: PieceFabric) => void } }) {
  const existing = value.pattern?.id === 'custom' && value.pattern.motif ? value.pattern : null;
  const [stage, setStage] = useState<Stage>(existing ? 'work' : 'start');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [motif, setMotif] = useState<PatternMotif | null>(existing?.motif ?? null);
  const [info, setInfo] = useState<RepeatInfo | null>(existing?.motif?.detectedTile ? { repeating: true, tile: existing.motif.detectedTile, confidence: 1 } : null);
  const [layout, setLayout] = useState<RepeatLayout>(existing?.layout ?? 'half-drop');
  const [motifScale, setMotifScale] = useState(existing?.motifScale ?? 0.6);
  const [scale, setScale] = useState(existing?.scale ?? 6);
  const [rotation, setRotation] = useState(existing?.rotation ?? 0);
  const [ground, setGround] = useState(existing?.colors[0] ?? fabricHex(value));
  const [recolour, setRecolour] = useState<string[] | undefined>(existing?.recolor);
  const [method, setMethod] = useState<'printed' | 'woven'>(existing?.method ?? 'printed');
  const selPiece = useStore((s) => s.selPiece);
  const pieceName = useStore((s) => s.project.pieces.find((p) => p.id === s.selPiece)?.name);

  const take = async (src: Bitmap) => {
    setBusy(true); setErr(null);
    try {
      const r = await detectRepeat(src);
      const m = await extractMotif(src, { repeat: r });
      if (!r.repeating) { const paths = vectoriseMotif(src, 3); if (paths) m.paths = paths; }
      setInfo(r); setMotif(m); setRecolour(undefined);
      if (r.repeating && r.tile) {
        setLayout('block'); setMotifScale(1);
        setScale(Math.max(0.5, Math.min(30, Math.round(((r.tile.w / src.w) * PHOTO_CM) * 2) / 2)));
      } else { setLayout(suggestLayout(m)); setMotifScale(0.6); setScale(6); }
      setStage('work');
    } catch { setErr('That picture could not be read. Try a PNG or JPG.'); }
    setBusy(false);
  };
  const onFile = async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErr('Choose a picture file (PNG, JPG or HEIC).'); return; }
    setBusy(true);
    try { await take(await prepareImage(f, 1024)); } catch { setErr('That picture could not be read. Try a PNG or JPG.'); setBusy(false); }
  };

  const pattern: FabricPattern | null = useMemo(() => (motif ? { id: 'custom', colors: [ground], scale, rotation, method, motif, layout, motifScale, ...(recolour && motif.paths ? { recolor: recolour } : {}) } : null), [motif, ground, scale, rotation, method, layout, motifScale, recolour]);
  const palette = useMemo(() => (motif?.paths ? [...new Set(motif.paths.map((p) => p.color))] : []), [motif]);

  const apply = (where: 'all' | 'piece' | 'inside') => {
    if (!pattern) return;
    const st = useStore.getState();
    const fab: PieceFabric = { ...value, pattern };
    if (target) { target.apply(fab); onClose(); return; }
    if (where === 'inside') {
      const f = { id: fab.id, color: fab.color, hex: fab.hex, pattern };
      if (selPiece) st.setInsideFabric(selPiece, f); else st.setInsideAll(f);
    } else { st.set({ fabricScope: where }); st.applyFabric(fab); }
    onClose();
  };

  return (
    <Sheet title="Your motif" onClose={onClose} wide label="Your motif">
      {stage === 'start' && (
        <div className="motif-start">
          <p className="step-sub" style={{ margin: 0 }}>Add a motif, such as a fleur de lis, or a photo of a repeating print. tech-it finds the repeat and fills the garment with it.</p>
          <div className="motif-options">
            <label className="motif-opt">
              <Icon name="print" size={26} /><b>Upload a picture</b><small>PNG, JPG or a photo. A plain background is removed for you.</small>
              <input type="file" accept="image/*" aria-label="Upload a motif picture" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <button className="motif-opt" onClick={() => setStage('draw')}><Icon name="draw" size={26} /><b>Draw it</b><small>Sketch with a pen or your finger.</small></button>
          </div>
          {busy && <p className="group-note" role="status">Reading your picture…</p>}
          {err && <p className="motif-err" role="alert">{err}</p>}
          <div className="alert-actions"><button className="btn" onClick={onClose}>Cancel</button></div>
        </div>
      )}

      {stage === 'draw' && <DrawMotif onBack={() => setStage('start')} onUse={(b) => void take(b)} busy={busy} />}

      {stage === 'work' && pattern && motif && (
        <div className="motif-work">
          <div className="motif-prev">
            <PatternCanvas pattern={pattern} ground={ground} cm={24} size={300} label="Live preview of the fabric with your motif" />
            <div className="scale-bar" aria-hidden="true"><span style={{ width: `${(scale / 24) * 100}%` }} /><small>{scale} cm repeat</small></div>
          </div>
          <div className="motif-ctl">
            <div className={`reco ${info?.repeating ? 'rep' : ''}`} role="status">
              <Icon name={info?.repeating ? 'grid' : 'sparkle'} size={18} />
              <span><b>{info?.repeating ? `Looks like a repeating pattern, repeat ${scale} x ${info.tile ? Math.max(0.5, Math.round(scale * (info.tile.h / info.tile.w) * 2) / 2) : scale} cm` : 'Single motif'}</b><small>{info?.repeating ? 'We kept one repeat. Check the size below.' : 'We removed the background and will repeat it for you.'}</small></span>
            </div>
            <div className="sublabel">Layout</div>
            <div className="layout-grid" role="group" aria-label="Layout">
              {LAYOUTS.map((l) => (
                <button key={l.id} className={`layout-tile ${layout === l.id ? 'on' : ''}`} aria-pressed={layout === l.id} title={l.hint} onClick={() => setLayout(l.id)}>
                  <PatternCanvas pattern={{ ...pattern, layout: l.id }} ground={ground} cm={scale * 3} size={52} label={l.label} />
                  <span className="fb-name">{l.label}</span>
                </button>
              ))}
            </div>
            <div className="frow stack"><label htmlFor="m-size">Motif size <b className="val">{Math.round(motifScale * 100)}%</b></label><input id="m-size" type="range" min={0.2} max={1} step={0.05} value={motifScale} onChange={(e) => setMotifScale(Number(e.target.value))} /></div>
            <div className="frow stack"><label htmlFor="m-gap">Spacing, repeat size <b className="val">{scale} cm</b></label><input id="m-gap" type="range" min={1} max={30} step={0.5} value={scale} onChange={(e) => setScale(Number(e.target.value))} /></div>
            <div className="frow stack"><label htmlFor="m-rot">Rotation <b className="val">{rotation}°</b></label><input id="m-rot" type="range" min={-90} max={90} step={5} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} /></div>
            <div className="frow stack"><span className="lbl">Ground colour</span><ColorField label="Ground colour" value={ground} colors={PALETTE} onChange={setGround} /></div>
            {palette.length > 0 && (
              <div className="frow stack">
                <span className="lbl">Recolour the motif <button className="btn small inline" onClick={() => setRecolour(recolour ? undefined : palette)}>{recolour ? 'Use original colours' : 'Recolour'}</button></span>
                {recolour && palette.map((_, i) => <ColorField key={i} label={`Motif colour ${i + 1}`} value={recolour[i] ?? palette[i]} colors={PALETTE} onChange={(hex) => setRecolour(palette.map((c, j) => (j === i ? hex : recolour[j] ?? c)))} />)}
              </div>
            )}
            <div className="frow stack">
              <span className="lbl">How it is made</span>
              <Seg label="Printed or woven" value={method} onChange={setMethod} options={[{ id: 'printed', label: 'Printed' }, { id: 'woven', label: 'Woven' }]} />
              <span className="group-note" style={{ padding: 0 }}>{method === 'printed' ? 'Ink on the outside. The inside shows plain cloth.' : 'Woven in, so it shows on the inside too.'}</span>
            </div>
          </div>
        </div>
      )}

      {stage === 'work' && (
        <div className="motif-apply">
          <button className="btn ghost" onClick={() => { setMotif(null); setStage('start'); }}><Icon name="refresh" size={16} /> Change motif</button>
          <span className="spacer" />
          {target ? <button className="btn primary" onClick={() => apply('all')}>Apply to {target.label.toLowerCase()}</button> : <div className="apply-group" role="group" aria-label="Apply to">
            <button className="btn" disabled={!selPiece} title={selPiece ? '' : 'Select a piece on the chart first'} onClick={() => apply('piece')}>{pieceName ? `Piece: ${pieceName}` : 'Selected piece'}</button>
            <button className="btn" onClick={() => apply('inside')}>{selPiece ? 'Inside of piece' : 'Inside'}</button>
            <button className="btn primary" onClick={() => apply('all')}>Apply to garment</button>
          </div>}
        </div>
      )}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- drawing canvas */

const INK = ['#1c1c1e', '#ffffff', '#ff3b30', '#ff9500', '#f2c94c', '#34c759', '#007aff', '#af52de'];

function DrawMotif({ onBack, onUse, busy }: { onBack: () => void; onUse: (b: Bitmap) => void; busy: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(INK[0]);
  const [width, setWidth] = useState(8);
  const [erase, setErase] = useState(false);
  const strokes = useRef<{ pts: { x: number; y: number }[]; color: string; width: number; erase: boolean }[]>([]);
  const cur = useRef<(typeof strokes.current)[number] | null>(null);
  const [n, setN] = useState(0);
  const SIZE = 360;

  const paint = () => {
    const c = ref.current!, ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of strokes.current) {
      ctx.save();
      ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * 2, p.y * 2) : ctx.moveTo(p.x * 2, p.y * 2)));
      if (s.pts.length === 1) { ctx.arc(s.pts[0].x * 2, s.pts[0].y * 2, s.width, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
      ctx.restore();
    }
  };
  useEffect(() => { const c = ref.current!; c.width = SIZE * 2; c.height = SIZE * 2; paint(); }, []);
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE }; };
  const down = (e: React.PointerEvent) => { e.preventDefault(); ref.current!.setPointerCapture(e.pointerId); cur.current = { pts: [at(e)], color, width: e.pointerType === 'pen' && e.pressure ? Math.max(2, width * (0.5 + e.pressure)) : width, erase }; strokes.current.push(cur.current); paint(); setN(strokes.current.length); };
  const move = (e: React.PointerEvent) => { if (!cur.current) return; cur.current.pts.push(at(e)); paint(); };
  const up = () => { cur.current = null; };
  const use = () => {
    const c = ref.current!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    onUse({ w: c.width, h: c.height, data: d.data });
  };
  return (
    <div className="draw-motif">
      <p className="step-sub" style={{ margin: 0 }}>Draw one motif. Use the pen or your finger. The background stays clear.</p>
      <div className="draw-wrap">
        <canvas ref={ref} className="draw-canvas" aria-label="Drawing area" style={{ width: SIZE, height: SIZE, touchAction: 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        <div className="draw-tools">
          <div className="nb-colors vertical" role="group" aria-label="Pen colour">
            {INK.map((c) => <button key={c} className={!erase && color === c ? 'on' : ''} aria-label={`Pen colour ${c}`} aria-pressed={!erase && color === c} style={{ background: c }} onClick={() => { setColor(c); setErase(false); }} />)}
          </div>
          <div className="seg" role="group" aria-label="Pen">
            {[{ w: 4, l: 'Fine' }, { w: 8, l: 'Medium' }, { w: 16, l: 'Bold' }].map((o) => <button key={o.w} className={width === o.w ? 'on' : ''} aria-pressed={width === o.w} aria-label={o.l} onClick={() => setWidth(o.w)}><span className="nb-dash" style={{ height: o.w / 2 + 1 }} /></button>)}
          </div>
          <button className={`btn small ${erase ? 'primary' : ''}`} aria-pressed={erase} onClick={() => setErase(!erase)}>Eraser</button>
          <button className="btn small" disabled={!n} onClick={() => { strokes.current.pop(); paint(); setN(strokes.current.length); }}><Icon name="undo" size={14} /> Undo</button>
          <button className="btn small" disabled={!n} onClick={() => { strokes.current = []; paint(); setN(0); }}>Clear</button>
        </div>
      </div>
      <div className="alert-actions">
        <button className="btn" onClick={onBack}>Back</button>
        <button className="btn primary" disabled={!n || busy} onClick={use}>{busy ? 'Working…' : 'Use this motif'}</button>
      </div>
    </div>
  );
}
