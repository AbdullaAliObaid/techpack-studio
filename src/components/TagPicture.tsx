// Pictures on a tag: upload a photo or logo, then size and place it inside the tag. It is stored as an image layer of the
// tag (the same layer the Design photo flow makes), so the 3D view, the chart and the tech pack all show it.
import { useId, useRef, useState } from 'react';
import type { Attachment, ShapeLayer } from '../data/edits';
import { uid } from '../lib/units';
import { bitmapToDataUrl, prepareImage } from './shims';
import { imageFileOf } from './editHelpers';
import { notify } from './notify';
import Icon from './Icon';

const MAX_PX = 512;

/** Largest size of a picture with this shape that fits inside the tag, then scaled by `pct` percent. */
const fit = (tag: { w: number; h: number }, aspect: number, pct: number) => {
  const k = Math.min(tag.w / aspect, tag.h) * 0.96;
  return { w: +(k * aspect * pct / 100).toFixed(3), h: +(k * pct / 100).toFixed(3) };
};
const pctOf = (tag: { w: number; h: number }, l: ShapeLayer) => Math.round((l.h / (Math.min(tag.w / (l.w / l.h), tag.h) * 0.96)) * 100);

export default function TagPicture({ att, patch }: { att: Attachment; patch: (p: Partial<Attachment>) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const pics = att.layers.filter((l) => l.shape === 'image' && l.image);
  const setLayer = (lid: string, p: Partial<ShapeLayer>) => patch({ layers: att.layers.map((l) => (l.id === lid ? { ...l, ...p } : l)) });
  const clampPos = (l: ShapeLayer, x: number, y: number) => ({ x: Math.max(-(att.w - l.w) / 2, Math.min((att.w - l.w) / 2, x)), y: Math.max(-(att.h - l.h) / 2, Math.min((att.h - l.h) / 2, y)) });

  const take = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && !imageFileOf([file])) { notify({ id: 'tag-pic-type', title: 'That is not a picture', body: 'Choose a PNG, JPG or HEIC picture for the tag.', tone: 'warn' }); return; }
    setBusy(true);
    try {
      const bmp = await prepareImage(file, MAX_PX);
      const url = bitmapToDataUrl(bmp, MAX_PX);
      const aspect = bmp.w / bmp.h;
      const size = fit(att, aspect, 100);
      patch({ layers: [...att.layers, { id: uid(), shape: 'image', x: 0, y: 0, ...size, rotation: 0, color: '#ffffff', image: url }] });
    } catch {
      notify({ id: 'tag-pic-read', title: 'That picture could not be read', body: 'Try a PNG or JPG. Very large or damaged files cannot be opened.', tone: 'error' });
    } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  return (
    <div className="frow stack tag-pics">
      <span className="lbl">Pictures on the tag</span>
      <input ref={input} type="file" accept="image/*" hidden aria-label="Choose a picture for the tag" onChange={(e) => void take(e.target.files?.[0])} />
      <button className="btn wide" disabled={busy} onClick={() => input.current?.click()}><Icon name="plus" size={16} /> {busy ? 'Opening picture' : 'Upload a picture'}</button>
      {pics.map((l, i) => {
        const pct = pctOf(att, l);
        const n = pics.length > 1 ? ` ${i + 1}` : '';
        return (
          <div className="tag-pic" key={l.id}>
            <div className="tag-pic-head">
              <img src={l.image} alt="" width={40} height={40} />
              <b>Picture{n}</b>
              <button className="icon-btn sm danger" aria-label={`Remove picture${n} from the tag`} title="Remove" onClick={() => patch({ layers: att.layers.filter((q) => q.id !== l.id) })}><Icon name="trash" size={16} /></button>
            </div>
            <div className="frow stack">
              <label htmlFor={`${id}-s${i}`}>Size <b className="val">{pct}%</b></label>
              <input id={`${id}-s${i}`} type="range" min={10} max={100} value={Math.max(10, Math.min(100, pct))}
                onChange={(e) => { const s = fit(att, l.w / l.h, Number(e.target.value)); setLayer(l.id, { ...s, ...clampPos({ ...l, ...s }, l.x, l.y) }); }} />
            </div>
            <div className="frow stack">
              <label htmlFor={`${id}-x${i}`}>Across</label>
              <input id={`${id}-x${i}`} type="range" min={-50} max={50} value={Math.round(((att.w - l.w) > 0.01 ? l.x / ((att.w - l.w) / 2) : 0) * 50)}
                onChange={(e) => setLayer(l.id, { x: clampPos(l, (Number(e.target.value) / 50) * ((att.w - l.w) / 2), l.y).x })} />
            </div>
            <div className="frow stack">
              <label htmlFor={`${id}-y${i}`}>Down</label>
              <input id={`${id}-y${i}`} type="range" min={-50} max={50} value={Math.round(((att.h - l.h) > 0.01 ? l.y / ((att.h - l.h) / 2) : 0) * 50)}
                onChange={(e) => setLayer(l.id, { y: clampPos(l, l.x, (Number(e.target.value) / 50) * ((att.h - l.h) / 2)).y })} />
            </div>
          </div>
        );
      })}
      <span className="group-note" style={{ padding: 0 }}>Printed or woven into the tag in colour. It shows on the chart, on the 3D tag and in the tech pack.</span>
    </div>
  );
}
