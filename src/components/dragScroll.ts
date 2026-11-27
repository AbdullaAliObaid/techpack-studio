// Drag to scroll for every horizontal scroller in the app (category chips, swatch rows, the workspace bar, movement
// modes...): press and drag sideways to roll through the options, with a little momentum; a vertical mouse wheel
// over a sideways-only row scrolls it sideways. A drag never also counts as a click on the chip under it.
// Installed once from App.

function scrollerFrom(el: Element | null): HTMLElement | null {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return n;
    }
  }
  return null;
}

/** inputs and the canvas / chart keep their own pointer handling */
function ownsPointer(el: Element | null) {
  return !!el?.closest('input, textarea, select, [contenteditable="true"], canvas, svg.chart, .chart, .artboard, [data-no-dragscroll]');
}

export function installDragScroll(): () => void {
  let s: { el: HTMLElement; x: number; left: number; moved: boolean; id: number; lastX: number; lastT: number; v: number } | null = null;
  let raf = 0;

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch' || ownsPointer(e.target as Element)) return; // touch scrolls natively
    const el = scrollerFrom(e.target as Element);
    if (!el) return;
    cancelAnimationFrame(raf);
    s = { el, x: e.clientX, left: el.scrollLeft, moved: false, id: e.pointerId, lastX: e.clientX, lastT: performance.now(), v: 0 };
  };
  const move = (e: PointerEvent) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    if (!s.moved && Math.abs(dx) < 5) return;
    if (!s.moved) { s.moved = true; s.el.classList.add('drag-scrolling'); }
    s.el.scrollLeft = s.left - dx;
    const t = performance.now(), dt = Math.max(1, t - s.lastT);
    s.v = 0.8 * ((s.lastX - e.clientX) / dt) + 0.2 * s.v;
    s.lastX = e.clientX; s.lastT = t;
    e.preventDefault();
  };
  const up = (e: PointerEvent) => {
    if (!s || e.pointerId !== s.id) return;
    const { el, moved } = s;
    let v = s.v;
    s = null;
    el.classList.remove('drag-scrolling');
    if (!moved) return;
    // the click that follows a drag is swallowed so the chip under the pointer isn't picked
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    // momentum
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let last = performance.now();
    const glide = (t: number) => {
      const dt = t - last; last = t;
      el.scrollLeft += v * dt;
      v *= Math.pow(0.92, dt / 16);
      if (Math.abs(v) > 0.02) raf = requestAnimationFrame(glide);
    };
    raf = requestAnimationFrame(glide);
  };
  const wheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.ctrlKey || ownsPointer(e.target as Element)) return;
    const el = scrollerFrom(e.target as Element);
    if (!el || el.scrollHeight > el.clientHeight + 2) return; // only rows that scroll sideways and not up and down
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  };

  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('wheel', wheel, { passive: false, capture: true });
  return () => {
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    window.removeEventListener('wheel', wheel, true);
  };
}
