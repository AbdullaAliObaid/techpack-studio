import * as THREE from 'three';
import type { Attachment, Edits } from '../data/edits';
import type { Piece } from '../data/presets';
import { fabricMaterial } from './materials';
import { labelMaterial } from './detailsLook';
import type { VertexPattern } from './printsAdapter';

// Two sided cloth. Every placed panel is drawn twice over the same geometry: the outside material on the side the
// worker says is outward (PanelInfo.front: +1 front faces, -1 back faces) and the inside material on the other side.
// Inside = Edits.insideFabric[pieceId] when set, else the outside fabric a little darker (the wrong side of cloth).
// Clothing tags that have a panel of their own use their type look (weave, grain, rubber ...) on both faces.
// Without panel info (front unknown) the cloth stays one double sided material and no inside layer is drawn.

const cache = new Map<string, THREE.Material>();

function sided(base: THREE.MeshStandardMaterial, side: THREE.Side, dark: number): THREE.Material {
  const key = `${base.uuid}|${side}|${dark}`;
  let m = cache.get(key);
  if (!m) {
    const c = base.clone();
    c.side = side;
    c.shadowSide = THREE.DoubleSide;
    if (dark !== 1) c.color.multiplyScalar(dark);
    cache.set(key, m = c);
  }
  return m;
}

const hidden = new THREE.MeshBasicMaterial({ visible: false });

export interface ClothMaterials { outside: THREE.Material[]; inside: THREE.Material[]; twoSided: boolean }

export function clothMaterials(fabrics: Piece['fabric'][], pat: VertexPattern, edits: Pick<Edits, 'insideFabric'>, attachments: Attachment[]): ClothMaterials {
  const outside: THREE.Material[] = [], inside: THREE.Material[] = [];
  let twoSided = false;
  fabrics.forEach((fb, k) => {
    const base = fabricMaterial(fb);
    const info = pat.panels?.[k];
    if (!info || !info.front) { outside.push(base); inside.push(hidden); return; }
    twoSided = true;
    const outSide = info.front > 0 ? THREE.FrontSide : THREE.BackSide;
    const inSide = info.front > 0 ? THREE.BackSide : THREE.FrontSide;
    const att = info.attachId ? attachments.find((a) => a.id === info.attachId) : undefined;
    if (att?.kind === 'label') {
      outside.push(labelMaterial(att.label, att.sheen, outSide));
      inside.push(labelMaterial(att.label, att.sheen, inSide));
      return;
    }
    outside.push(sided(base, outSide, 1));
    const pieceId = pat.pieceIds[info.pieceIndex];
    const inner = edits.insideFabric?.[pieceId];
    inside.push(inner ? sided(fabricMaterial(inner), inSide, 1) : sided(base, inSide, 0.8));
  });
  return { outside, inside, twoSided };
}
