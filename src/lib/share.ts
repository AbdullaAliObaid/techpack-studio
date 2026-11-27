// Share files: export projects (with pictures), read someone else's file safely, and save it as imported projects.
// Format: ShareFile (src/store.ts), JSON, gzip compressed when the browser can (CompressionStream), extension .techit.

import type { BodyPreset, Outfit, Project, ShareFile } from '../store';
import { migrateGarment, CATALOG } from '../data/catalog';
import { uid } from './units';
import { saveProject } from './projects';
import { saveImportedBodies } from './projects';

export const SHARE_EXT = '.techit';
export const SHARE_VERSION = 1;
/** limits: file as received, and after unzipping */
export const MAX_FILE_BYTES = 80 * 1024 * 1024;
export const MAX_JSON_BYTES = 300 * 1024 * 1024;
const MAX_PROJECTS = 200, MAX_PIECES = 200, MAX_POINTS = 4000, MAX_ATTACH = 1000, MAX_NOTES = 1000, MAX_PICTURE = 8 * 1024 * 1024;

export class ShareError extends Error {}

const hasGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function pipe(blob: Blob, t: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = blob.stream().pipeThrough(t as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) { await reader.cancel(); throw new ShareError('This file is too large to open.'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of parts) { out.set(c, o); o += c.length; }
  return out;
}

/** Build a .techit file. `from` is a name shown to the people who open it. */
export async function exportShareFile(projects: Project[], outfits?: Outfit[], bodies?: BodyPreset[], opts: { from?: string } = {}): Promise<Blob> {
  const sf: ShareFile & { from?: string } = {
    format: 'tech-it', version: SHARE_VERSION, exportedAt: Date.now(), app: 'tech-it 0.1',
    projects, ...(outfits?.length ? { outfits } : {}), ...(bodies?.length ? { bodies } : {}), ...(opts.from ? { from: opts.from } : {}),
  };
  const json = new Blob([JSON.stringify(sf)], { type: 'application/json' });
  if (!hasGzip()) return json;
  try {
    const gz = await pipe(json, new CompressionStream('gzip'), MAX_JSON_BYTES);
    return new Blob([gz as BlobPart], { type: 'application/gzip' });
  } catch {
    return json;
  }
}

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const IMG = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]*$/i;

/** Copy a JSON value, dropping dangerous keys, non-image data URLs and oversized pictures. Numbers must be finite. */
function clean(v: unknown, depth = 0): unknown {
  if (depth > 40) throw new ShareError('This file is nested too deeply to be a tech-it file.');
  if (typeof v === 'string') {
    if (v.startsWith('data:')) return IMG.test(v) && v.length <= MAX_PICTURE ? v : undefined;
    return v.length > 100000 ? v.slice(0, 100000) : v;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { if (!BAD_KEYS.has(k)) { const c = clean(x, depth + 1); if (c !== undefined) o[k] = c; } }
    return o;
  }
  return v;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const BODY_KEYS = ['height', 'chest', 'waist', 'hips', 'shoulder', 'arm', 'inseam', 'neck'];

function checkBody(b: unknown, where: string) {
  if (!isObj(b) || !BODY_KEYS.every((k) => typeof b[k] === 'number' && (b[k] as number) > 0)) throw new ShareError(`${where} has no valid body measurements.`);
}

function checkProject(p: unknown, i: number): Project {
  const name = isObj(p) && typeof p.name === 'string' ? p.name : `project ${i + 1}`;
  if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.garment !== 'string') throw new ShareError(`"${name}" is not a valid project.`);
  if (!Array.isArray(p.pieces) || p.pieces.length > MAX_PIECES) throw new ShareError(`"${name}" has no valid pattern pieces.`);
  for (const pc of p.pieces) {
    if (!isObj(pc) || typeof pc.id !== 'string' || !Array.isArray(pc.points) || pc.points.length > MAX_POINTS || !isObj(pc.fabric) || !isObj(pc.offset)) throw new ShareError(`"${name}" has a damaged pattern piece.`);
    for (const q of pc.points) if (!isObj(q) || typeof q.x !== 'number' || typeof q.y !== 'number' || typeof q.id !== 'string') throw new ShareError(`"${name}" has a damaged pattern piece.`);
  }
  checkBody(p.body, `"${name}"`);
  if (p.edits !== undefined) {
    if (!isObj(p.edits) || !Array.isArray(p.edits.attachments) || (p.edits.attachments as unknown[]).length > MAX_ATTACH) throw new ShareError(`"${name}" has damaged edits.`);
  }
  if (p.notes !== undefined && (!Array.isArray(p.notes) || p.notes.length > MAX_NOTES)) throw new ShareError(`"${name}" has damaged notes.`);
  const garment = migrateGarment(p.garment as never);
  if (!CATALOG.some((s) => s.id === garment)) throw new ShareError(`"${name}" uses a garment style this version does not know (${p.garment}).`);
  return { ...(p as unknown as Project), name: p.name.trim().slice(0, 120) || 'Untitled', garment, linkPattern: p.linkPattern !== false, updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now() };
}

/** Read and validate a .techit file. Throws ShareError with a plain message for anything that is not a usable tech-it file. */
export async function readShareFile(file: Blob): Promise<ShareFile & { from?: string }> {
  if (file.size > MAX_FILE_BYTES) throw new ShareError('This file is too large to open.');
  if (file.size === 0) throw new ShareError('This file is empty.');
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let text: string;
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (!hasGzip()) throw new ShareError('This file is compressed and this browser cannot open it. Update your browser, or ask for the file again from a newer one.');
    try { text = new TextDecoder().decode(await pipe(file, new DecompressionStream('gzip'), MAX_JSON_BYTES)); }
    catch (e) { throw e instanceof ShareError ? e : new ShareError('This file is damaged: it could not be unzipped.'); }
  } else {
    text = await file.text();
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ShareError('This is not a tech-it file.'); }
  if (!isObj(raw) || raw.format !== 'tech-it') throw new ShareError('This is not a tech-it file.');
  if (typeof raw.version !== 'number') throw new ShareError('This is not a tech-it file.');
  if (raw.version > SHARE_VERSION) throw new ShareError('This file was made with a newer version of tech-it. Update the app and try again.');
  if (!Array.isArray(raw.projects) || !raw.projects.length && !raw.outfits && !raw.bodies) throw new ShareError('This file has nothing to import.');
  if (raw.projects.length > MAX_PROJECTS) throw new ShareError('This file has too many projects.');
  const c = clean(raw) as Record<string, unknown>;
  const projects = (c.projects as unknown[]).map(checkProject);
  const outfits = Array.isArray(c.outfits) ? (c.outfits as unknown[]).filter((o): o is Outfit => isObj(o) && typeof o.id === 'string' && typeof o.name === 'string' && Array.isArray(o.items) && isObj(o.body)).slice(0, 200) : undefined;
  const bodies = Array.isArray(c.bodies) ? (c.bodies as unknown[]).filter((b): b is BodyPreset => isObj(b) && typeof b.id === 'string' && typeof b.name === 'string' && isObj(b.body) && BODY_KEYS.every((k) => typeof (b.body as Record<string, unknown>)[k] === 'number')).slice(0, 200) : undefined;
  return {
    format: 'tech-it', version: 1, exportedAt: typeof c.exportedAt === 'number' ? c.exportedAt : Date.now(), app: typeof c.app === 'string' ? c.app : 'tech-it',
    projects, ...(outfits?.length ? { outfits } : {}), ...(bodies?.length ? { bodies } : {}), ...(typeof c.from === 'string' ? { from: c.from.slice(0, 80) } : {}),
  };
}

export interface ImportResult { projects: Project[]; outfits: Outfit[]; bodies: BodyPreset[] }

/**
 * Save a read file as new local items: every project, outfit and body preset gets a fresh id (so importing twice or
 * importing your own file makes copies, never overwrites), outfit items follow their projects to the new ids, and
 * projects carry `imported = {from, at, fileName}`. Outfits are returned (and handed to opts.saveOutfit) because they
 * are stored by the outfit feature. An outfit item whose project is not in the file and not saved here is dropped.
 */
export function importShareFile(sf: ShareFile & { from?: string }, opts: { fileName?: string; from?: string; saveOutfit?: (o: Outfit) => void; hasProject?: (id: string) => boolean } = {}): ImportResult {
  const at = Date.now();
  const from = opts.from ?? sf.from;
  const map = new Map<string, string>();
  const projects = sf.projects.map((p) => {
    const id = uid() + uid();
    map.set(p.id, id);
    const q: Project = { ...p, id, updatedAt: at, imported: { ...(from ? { from } : {}), at, ...(opts.fileName ? { fileName: opts.fileName } : {}) } };
    saveProject(q);
    return q;
  });
  const outfits = (sf.outfits ?? []).map((o) => {
    const items = o.items.flatMap((it) => {
      const pid = map.get(it.projectId) ?? (opts.hasProject?.(it.projectId) ? it.projectId : undefined);
      return pid ? [{ ...it, projectId: pid }] : [];
    });
    const q: Outfit = { ...o, id: uid() + uid(), items, updatedAt: at };
    opts.saveOutfit?.(q);
    return q;
  });
  const bodies = saveImportedBodies(sf.bodies ?? []);
  return { projects, outfits, bodies };
}

const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'project';

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Share one project: the system share sheet with the file where the browser allows it (iPad, phones), else a download. */
export async function shareProject(project: Project, opts: { from?: string } = {}): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await exportShareFile([project], undefined, undefined, opts);
  const name = `${safeName(project.name)}${SHARE_EXT}`;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.canShare && nav.share) {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    try {
      if (nav.canShare({ files: [file] })) { await nav.share({ files: [file], title: project.name }); return 'shared'; }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, name);
  return 'downloaded';
}
