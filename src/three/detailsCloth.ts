import * as THREE from 'three';
import type { Attachment, Edits } from '../data/edits';
import type { Piece } from '../data/presets';
import { clothMaterial, isPlain, isWoven } from './detailsPattern';
import { labelMaterial } from './detailsLook';
import type { VertexPattern } from './printsAdapter';

// Two sided cloth. Every placed panel is drawn twice over the same geometry: the outside material on the side the
// worker says is outward (PanelInfo.front: +1 front faces, -1 back faces) and the inside material on the other side.
// Inside = Edits.insideFabric[pieceId] when set, else the outside fabric a little darker (the wrong side of cloth);
// a printed pattern has only its ground colour there, a woven one shows on both faces (src/three/detailsPattern.ts).
// Clothing tags that have a panel of their own use their type look (weave, grain, rubber ...) on both faces.
// Without panel info (front unknown) the cloth stays one double sided material and no inside layer is drawn.

const hidden = new THREE.MeshBasicMaterial({ visible: false });

export interface ClothMaterials { outside: THREE.Material[]; inside: THREE.Material[]; twoSided: boolean }

export function clothMaterials(fabrics: Piece['fabric'][], pat: VertexPattern, edits: Pick<Edits, 'insideFabric'>, attachments: Attachment[]): ClothMaterials {
  const outside: THREE.Material[] = [], inside: THREE.Material[] = [];
  let twoSided = false;
  fabrics.forEach((fb, k) => {
    const info = pat.panels?.[k];
    if (!info || !info.front) { outside.push(clothMaterial(fb, THREE.DoubleSide)); inside.push(hidden); return; }
    twoSided = true;
    const outSide = info.front > 0 ? THREE.FrontSide : THREE.BackSide;
    const inSide = info.front > 0 ? THREE.BackSide : THREE.FrontSide;
    const att = info.attachId ? attachments.find((a) => a.id === info.attachId) : undefined;
    if (att?.kind === 'label') {
      outside.push(labelMaterial(att.label, att.sheen, outSide));
      inside.push(labelMaterial(att.label, att.sheen, inSide));
      return;
    }
    outside.push(clothMaterial(fb, outSide));
    const pieceId = pat.pieceIds[info.pieceIndex];
    const inner = edits.insideFabric?.[pieceId];
    // the wrong side: woven patterns and plain cloth show through a little duller, a printed pattern is only ink on
    // the outside so its inside is the ground colour
    inside.push(inner ? clothMaterial(inner, inSide) : clothMaterial(fb, inSide, 0.8, { ground: !isPlain(fb.pattern) && !isWoven(fb.pattern) }));
  });
  return { outside, inside, twoSided };
}
