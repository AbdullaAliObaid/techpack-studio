// "From a photo": a picture dropped on the chart or the 3D view, pasted, or chosen from Insert design. The sheet shows the
// picture, lets the user crop it and remove its background, then turns it into part of the clothing:
//   Print it            a full colour picture printed on the cloth (layer 'image', stored at 1024 px or less)
//   Stitch it           embroidery: the picture reduced to a few thread colours and traced into stitched shapes
//   Cut it from fabric  appliqué: the same traced shapes, cut from cloth and sewn on
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, usePick } from '../store';
import type { Attachment } from '../data/edits';
import { centroid, samplePoly } from '../lib/geometry';
import { pathRings } from '../lib/shapes';
import { uid } from '../lib/units';
import { designHost, imageFileOf, PHOTO_EVENT, prepareImage, cropBitmap, removeBackground, posterize, traceToPaths, traceSilhouette, toLayers, bitmapToDataUrl, dataUrlKb, downscale, hasAlpha, type Bitmap, type PhotoTarget } from './editHelpers';
import { copiesOf, instanceName } from './sides';
import { Disclosure, LenInput, Row, Seg, Switch } from './controls';
import Icon from './Icon';

type Mode = 'print' | 'stitch' | 'cut';
const MAX_THREADS = 12;
const BIG_KB = 400;

export default function PhotoSheet() {
  const [src, setSrc] = useState<{ bmp: Bitmap; target?: PhotoTarget } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const load = async (file: Blob, target?: PhotoTarget) => {
      try { setErr(null); setSrc({ bmp: await prepareImage(file, 1024), target }); } catch (e) { setErr((e as Error).message); setSrc(null); }
    };
    const onEvent = (e: Event) => { const d = (e as CustomEvent<{ file: Blob; target?: PhotoTarget }>).detail; void load(d.file, d.target); };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (useStore.getState().screen !== 'editor') return;
      const f = imageFileOf(Array.from(e.clipboardData?.items ?? []).map((i) => i.getAsFile()).filter((x): x is File => !!x));
      if (f) { e.preventDefault(); void load(f); }
    };
    window.addEventListener(PHOTO_EVENT, onEvent);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener(PHOTO_EVENT, onEvent); window.removeEventListener('paste', onPaste); };
  }, []);

  if (err) {
    return createPortal(
      <div className="sheet-backdrop" role="presentation" onPointerDown={() => setErr(null)}>
        <div className="sheet alert material" role="alertdialog" aria-labelledby="ph-err">
          <h2 id="ph-err">Could not open that picture</h2>
          <p className="group-note">{err}</p>
          <button className="btn primary" onClick={() => setErr(null)}>OK</button>
        </div>
      </div>, document.body);
  }
  return src ? <Sheet key={src.bmp.data.length + src.bmp.w} bmp={src.bmp} target={src.target} onClose={() => setSrc(null)} /> : null;
}

function Sheet({ bmp, target, onClose }: { bmp: Bitmap; target?: PhotoTarget; onClose: () => void }) {
  const { project, selPiece, selAttachment, selInstance, showBothSides, designFace, units, addAttachment, openDesign, set } = usePick('project', 'selPiece', 'selAttachment', 'selInstance', 'showBothSides', 'designFace', 'units', 'addAttachment', 'openDesign', 'set');
  const [mode, setMode] = useState<Mode>('print');
  const [crop, setCrop] = useState({ l: 0, r: 0, t: 0, b: 0 }); // percent trimmed from each side
  const [bgOn, setBgOn] = useState(false);
  const [tol, setTol] = useState(35);
  const [n, setN] = useState(5);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const aspect0 = bmp.w / bmp.h;
  const [longest, setLongest] = useState(10);

  // ---- where it goes
  const atts = project.edits?.attachments ?? [];
  const dh = designHost(project.pieces, atts, selPiece, selAttachment);
  const hostPiece = target ? project.pieces.find((p) => p.id === target.pieceId) : dh?.piece ?? project.pieces.find((p) => p.role === 'front') ?? project.pieces[0];
  const onAtt = !target && !!dh?.attachment;
  const copies = hostPiece ? copiesOf(project.garment, hostPiece) : 1;
  const inst = target ? target.instance : hostPiece && copies === 2 && showBothSides ? selInstance ?? 0 : undefined;
  const where = hostPiece ? (inst !== undefined && copies === 2 ? instanceName(project.garment, hostPiece, inst) : hostPiece.name) : 'the garment';

  // ---- the picture, step by step
  const cropped = useMemo(() => cropBitmap(bmp, { x: crop.l / 100, y: crop.t / 100, w: 1 - (crop.l + crop.r) / 100, h: 1 - (crop.t + crop.b) / 100 }), [bmp, crop]);
  const cleaned = useMemo(() => (bgOn ? removeBackground(cropped, tol) : cropped), [cropped, bgOn, tol]);
  const small = useMemo(() => downscale(cleaned, 256), [cleaned]);
  const poster = useMemo(() => (mode === 'print' ? null : posterize(small, Math.min(n, MAX_THREADS))), [small, n, mode]);
  const paths = useMemo(() => (poster ? traceToPaths(poster) : []), [poster]);
  const palette = useMemo(() => (poster?.palette ?? []).map((c, i) => edited[i] ?? c), [poster, edited]);
  const aspect = cleaned.w / cleaned.h;
  const W = aspect >= 1 ? longest : longest * aspect, H = aspect >= 1 ? longest / aspect : longest;

  // preview canvas for the print view
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current;
    if (!c || mode !== 'print') return;
    c.width = cleaned.w; c.height = cleaned.h;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(cleaned.data), cleaned.w, cleaned.h), 0, 0);
  }, [cleaned, mode]);

  const printUrl = useMemo(() => (mode === 'print' ? bitmapToDataUrl(cleaned, 1024) : ''), [cleaned, mode]);
  const kb = mode === 'print' ? dataUrlKb(printUrl) : Math.round(paths.reduce((a, p) => a + p.d.length, 0) / 1024);
  const big = kb > BIG_KB;
  const transparent = hasAlpha(cleaned);

  const add = () => {
    if (!hostPiece) return;
    const base = { rotation: 0, w: W, h: H, outline: 'rect' as const };
    let x = target?.x ?? 0, y = target?.y ?? 0;
    if (!target && !onAtt) { const c = centroid(samplePoly(hostPiece.points)); x = c.x; y = c.y; }
    const face = designFace === 'inside' ? { face: 'inside' as const } : {};
    const where2 = { pieceId: onAtt && dh ? dh.id : hostPiece.id, x, y, ...(inst !== undefined && !onAtt ? { instance: inst } : {}) };
    let a: Omit<Attachment, 'id'>;
    if (mode === 'print') {
      a = { ...base, ...where2, ...face, kind: 'print', name: 'Photo print', layers: [{ id: uid(), shape: 'image', x: 0, y: 0, w: W, h: H, rotation: 0, color: '#ffffff', image: printUrl }] };
    } else if (mode === 'stitch') {
      a = { ...base, ...where2, ...face, kind: 'embroidery', name: 'Stitched picture', thread: palette[0], layers: toLayers(paths, palette, W, H) };
    } else {
      const ring = poster ? pathRings(traceSilhouette(poster)).reduce<{ x: number; y: number }[]>((best, r) => (r.length > best.length ? r : best), []) : [];
      const points = ring.length >= 3 ? ring.map((q) => ({ x: Math.round(q.x * W * 1000) / 1000, y: Math.round(q.y * H * 1000) / 1000 })) : undefined;
      a = {
        ...where2, ...face, kind: 'applique', name: 'Cut picture', rotation: 0, w: W, h: H, outline: points ? 'custom' : 'rect', ...(points ? { points } : {}), thread: palette[0],
        fabric: { id: hostPiece.fabric.id, color: 0, hex: palette[0] },
        layers: toLayers(paths.filter((p) => p.ci !== 0), palette, W, H),
      };
    }
    addAttachment(a);
    set({ selLayer: null, selPiece: hostPiece.id, selInstance: inst ?? null });
    openDesign('edit');
    onClose();
  };

  const nPaths = poster?.palette.length ?? 0;
  const hint = mode === 'print' ? 'Printed in full colour, like a photo transfer.' : mode === 'stitch' ? 'Thread colours are limited, so the picture is simplified into flat areas of colour.' : 'Each colour is cut from its own cloth and sewn on. The outline of the picture is the cut shape.';

  return createPortal(
    <div className="sheet-backdrop" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet photo-sheet material" role="dialog" aria-modal="true" aria-labelledby="photo-title">
        <div className="flow-head">
          <h2 id="photo-title" style={{ flex: 1 }}>Add a photo <small>to {where}</small></h2>
          <button className="icon-btn" aria-label="Close" title="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>

        <div className="photo-stage" aria-label="Preview">
          <div className="photo-checker" style={{ aspectRatio: String(aspect), width: `min(100%, ${Math.round(280 * aspect)}px)` }}>
            {mode === 'print'
              ? <canvas ref={cv} role="img" aria-label="The picture as it will be printed" />
              : (
                <svg viewBox="-0.5 -0.5 1 1" preserveAspectRatio="none" role="img" aria-label="The picture as stitched or cut shapes">
                  {paths.map((p) => <path key={p.ci} d={p.d} fill={palette[p.ci]} fillRule="evenodd" />)}
                </svg>
              )}
            {(crop.l || crop.r || crop.t || crop.b) ? <span className="photo-cropmark" aria-hidden="true" /> : null}
          </div>
        </div>

        <Seg label="What to make from it" value={mode} onChange={setMode} options={[{ id: 'print', label: 'Print it' }, { id: 'stitch', label: 'Stitch it' }, { id: 'cut', label: 'Cut it from fabric' }]} />
        <p className="group-note">{hint}</p>

        <Row label="Remove background"><Switch label="Remove the background" on={bgOn} onChange={setBgOn} /></Row>
        {bgOn && (
          <div className="frow stack">
            <label htmlFor="ph-tol">Tolerance <b className="val">{tol}</b></label>
            <input id="ph-tol" type="range" min={0} max={100} value={tol} onChange={(e) => setTol(Number(e.target.value))} />
            <span className="group-note" style={{ padding: 0 }}>Higher removes more of the colours that touch the edge. {transparent ? '' : 'Nothing was removed yet. Raise it.'}</span>
          </div>
        )}

        {mode !== 'print' && (
          <>
            <div className="frow stack">
              <label htmlFor="ph-n">Colours <b className="val">{nPaths} of {Math.min(n, MAX_THREADS)}</b></label>
              <input id="ph-n" type="range" min={2} max={MAX_THREADS} value={n} onChange={(e) => { setN(Number(e.target.value)); setEdited({}); }} />
              <span className="group-note" style={{ padding: 0 }}>At most {MAX_THREADS} {mode === 'stitch' ? 'thread colours' : 'cloth colours'}.</span>
            </div>
            <div className="photo-palette" role="group" aria-label="Colours, press one to change it">
              {palette.map((c, i) => (
                <label key={i} className="photo-chip" title={`Change colour ${i + 1}`}>
                  <span style={{ background: c }} />
                  <input type="color" aria-label={`Colour ${i + 1}, ${c}`} value={c} onChange={(e) => setEdited({ ...edited, [i]: e.target.value })} />
                </label>
              ))}
            </div>
          </>
        )}

        <Row label="Size, longest side"><LenInput units={units} label="Longest side" value={longest} min={1.5} max={45} onChange={setLongest} /></Row>
        <p className="group-note">{(W).toFixed(1)} by {(H).toFixed(1)} cm{aspect0 && Math.abs(aspect - aspect0) > 0.01 ? ', after cropping' : ''}. Keeps the picture's shape.</p>

        <Disclosure id="photo-crop" title="Crop" icon="fit">
          {(['l', 'r', 't', 'b'] as const).map((k) => (
            <div className="frow stack" key={k}>
              <label htmlFor={`ph-crop-${k}`}>{{ l: 'Trim left', r: 'Trim right', t: 'Trim top', b: 'Trim bottom' }[k]} <b className="val">{crop[k]}%</b></label>
              <input id={`ph-crop-${k}`} type="range" min={0} max={45} value={crop[k]} onChange={(e) => setCrop({ ...crop, [k]: Number(e.target.value) })} />
            </div>
          ))}
        </Disclosure>

        {big && (
          <div className="callout-box warn" role="status">
            <Icon name="info" size={16} />
            <span>This picture is large, about {kb} KB. It is saved inside your project, so a big one makes saving and opening slower. Crop it or print it smaller to keep the project light.</span>
          </div>
        )}
        {!big && mode === 'print' && kb > 120 && <p className="group-note">About {kb} KB, saved inside your project.</p>}

        <div className="flow-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!hostPiece || (mode !== 'print' && !paths.length)} onClick={add}>{mode === 'print' ? 'Print on' : mode === 'stitch' ? 'Stitch onto' : 'Cut and sew onto'} {where}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
