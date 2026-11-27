// Pull the cloth by hand in the 3D view (store.pullMode): press on the cloth and drag; the point under the pointer is
// drawn toward it in the simulation (worker 'grab' / 'release' messages, a soft spring) and the rest of the garment
// follows, with gravity and the body still acting. Let go and it settles from there. Shift-click (or a long press on
// touch) pins a point where it is, shown as a dot; the same on a pinned point lets it go. Orbiting is off while pulling.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const dotGeo = new THREE.SphereGeometry(0.7, 12, 8);
const dotMat = new THREE.MeshBasicMaterial({ color: '#ff9f0a', depthTest: false, transparent: true, opacity: 0.95 });
const grabMat = new THREE.MeshBasicMaterial({ color: '#0a84ff', depthTest: false, transparent: true, opacity: 0.95 });
const MAX_PINS = 64;
const LONG_PRESS = 550; // ms, pins on touch and Pencil

export default function Pull({ geo, worker, enabled }: { geo: THREE.BufferGeometry; worker: Worker; enabled: boolean }) {
  const { gl, camera, controls, invalidate } = useThree();
  const pins = useRef<number[]>([]);
  const grabbed = useRef(-1);
  const dots = useRef<THREE.InstancedMesh>(null);
  const grabDot = useRef<THREE.Mesh>(null);
  // the cloth to hit: its own mesh over the same geometry (both faces)
  const hitMesh = useMemo(() => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), [geo]);
  // a new build is a new cloth: pins and a grab do not carry over
  useEffect(() => { pins.current = []; grabbed.current = -1; }, [geo]);

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;
    const orbit = controls as unknown as { enabled: boolean } | null;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const plane = new THREE.Plane(), at = new THREE.Vector3(), normal = new THREE.Vector3();
    let pointer = -1, timer: ReturnType<typeof setTimeout> | null = null, startXY = { x: 0, y: 0 }, moved = false;
    const cast = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    /** cloth vertex nearest the point hit under the pointer, or -1 */
    const pick = (e: PointerEvent): number => {
      cast(e);
      geo.computeBoundingSphere();
      const hit = ray.intersectObject(hitMesh, false)[0];
      if (!hit || !hit.face) return -1;
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      let best = -1, bd = Infinity;
      for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
        const d = at.fromBufferAttribute(pos, v).distanceToSquared(hit.point);
        if (d < bd) { bd = d; best = v; }
      }
      // drag on a plane through the point, facing the camera
      at.fromBufferAttribute(pos, best);
      camera.getWorldDirection(normal);
      plane.setFromNormalAndCoplanarPoint(normal, at);
      return best;
    };
    const togglePin = (v: number) => {
      const on = !pins.current.includes(v);
      pins.current = on ? [...pins.current, v].slice(-MAX_PINS) : pins.current.filter((q) => q !== v);
      worker.postMessage({ type: 'pin', vertex: v, on });
      invalidate();
    };
    const end = (e: PointerEvent) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (e.pointerId !== pointer) return;
      pointer = -1;
      if (grabbed.current >= 0) worker.postMessage({ type: 'release' });
      grabbed.current = -1;
      if (orbit) orbit.enabled = true;
      try { el.releasePointerCapture(e.pointerId); } catch { /* released */ }
      invalidate();
    };
    const down = (e: PointerEvent) => {
      if (pointer >= 0 || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const v = pick(e);
      if (v < 0) return; // off the cloth: orbit as usual
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) { togglePin(v); return; }
      pointer = e.pointerId; startXY = { x: e.clientX, y: e.clientY }; moved = false;
      grabbed.current = v;
      if (orbit) orbit.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      worker.postMessage({ type: 'grab', vertex: v, target: [at.x, at.y, at.z] });
      // touch and Pencil have no Shift: hold still to pin
      if (e.pointerType !== 'mouse') timer = setTimeout(() => { timer = null; if (!moved && grabbed.current === v) { worker.postMessage({ type: 'release' }); grabbed.current = -1; togglePin(v); } }, LONG_PRESS);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer || grabbed.current < 0) return;
      if (Math.hypot(e.clientX - startXY.x, e.clientY - startXY.y) > 6) moved = true;
      cast(e);
      if (!ray.ray.intersectPlane(plane, at)) return;
      worker.postMessage({ type: 'grab', vertex: grabbed.current, target: [at.x, at.y, at.z] });
      invalidate();
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      if (timer) clearTimeout(timer);
      if (grabbed.current >= 0) worker.postMessage({ type: 'release' });
      grabbed.current = -1;
      if (orbit) orbit.enabled = true;
    };
  }, [enabled, gl, camera, controls, geo, hitMesh, worker, invalidate]);

  // dots on the pins and the point being pulled, following the cloth
  const m = useMemo(() => new THREE.Matrix4(), []);
  const v3 = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const d = dots.current;
    if (d) {
      d.count = pins.current.length;
      pins.current.forEach((v, i) => { if (v < pos.count) { v3.fromBufferAttribute(pos, v); m.makeTranslation(v3.x, v3.y, v3.z); d.setMatrixAt(i, m); } });
      d.instanceMatrix.needsUpdate = true;
    }
    const g = grabDot.current;
    if (g) {
      g.visible = grabbed.current >= 0 && grabbed.current < pos.count;
      if (g.visible) g.position.fromBufferAttribute(pos, grabbed.current);
    }
  });
  return (
    <group>
      <instancedMesh ref={dots} args={[dotGeo, dotMat, MAX_PINS]} renderOrder={11} frustumCulled={false} />
      <mesh ref={grabDot} geometry={dotGeo} material={grabMat} renderOrder={11} visible={false} />
    </group>
  );
}
