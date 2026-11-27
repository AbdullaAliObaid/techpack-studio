import type { RootState } from '@react-three/fiber';

// Render budget for the 3D view. The scene renders on demand (only when the cloth, camera or scene changes), the
// pixel ratio is capped, and touch devices (iPad) get a smaller shadow map and a lower cap.

const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** device pixel ratio range for the WebGL canvas: Retina iPads report 2, which is 1.8x the pixels of 1.5 */
export const VIEW_DPR: [number, number] = coarse ? [1, 1.25] : [1, 1.5];

/** key light shadow map size */
export const SHADOW_MAP = coarse ? 1024 : 2048;

/**
 * Without preserveDrawingBuffer (expensive on tile based GPUs) the canvas is cleared after it is shown, so a
 * screenshot (tech pack PDF export reads canvas.toDataURL) renders a fresh frame first, in the same task.
 */
export function captureOnDemand(st: RootState) {
  const el = st.gl.domElement;
  const toDataURL = el.toDataURL.bind(el);
  el.toDataURL = (...a: Parameters<HTMLCanvasElement['toDataURL']>) => {
    const s = st.get();
    s.gl.render(s.scene, s.camera);
    return toDataURL(...a);
  };
}
