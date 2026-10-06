import { useEffect, useRef } from 'react';
import { haptic } from './haptics.js';

const EDGE = 24; // ширина зоны у левого края, откуда начинается жест «назад»

// Смахивание от левого края вправо — возврат на предыдущий экран.
export function useEdgeSwipe(enabled, onBack) {
  const cb = useRef(onBack);
  cb.current = onBack;

  useEffect(() => {
    if (!enabled) return undefined;
    let st = null;
    const screen = () => document.querySelector('.app > .screen');

    const down = (e) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || t.clientX > EDGE) return;
      if (document.querySelector('.sheet-layer, .dialog-layer, .peek-layer, .onboarding, .editor')) return;
      st = { x: t.clientX, y: t.clientY, dx: 0, active: false, el: screen() };
    };
    const move = (e) => {
      if (!st) return;
      const t = e.touches[0];
      const dx = t.clientX - st.x;
      const dy = t.clientY - st.y;
      if (!st.active) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > dx) { st = null; return; }
        if (dx > 10) st.active = true; else return;
      }
      st.dx = Math.max(0, dx);
      if (st.el) {
        st.el.style.transition = 'none';
        st.el.style.transform = `translateX(${st.dx}px)`;
        st.el.style.boxShadow = '-12px 0 30px rgba(0,0,0,0.45)';
      }
    };
    const up = () => {
      if (!st) return;
      const { el, dx, active } = st;
      st = null;
      if (!active || !el) return;
      const go = dx > Math.min(110, window.innerWidth * 0.28);
      el.style.transition = 'transform 0.2s ease-out';
      el.style.transform = go ? `translateX(${window.innerWidth}px)` : 'translateX(0)';
      setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
        el.style.boxShadow = '';
        if (go) { haptic('light'); cb.current(); }
      }, go ? 160 : 210);
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, [enabled]);
}

// Смахивание строки влево открывает быстрые действия.
export function useRowSwipe({ width, enabled = true }) {
  const st = useRef(null);
  const offset = useRef(0);
  const ref = useRef(null);
  const moved = useRef(false);

  const apply = (x, anim) => {
    offset.current = x;
    const el = ref.current;
    if (!el) return;
    el.style.transition = anim ? 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    el.style.transform = x ? `translateX(${x}px)` : '';
  };

  const close = () => apply(0, true);

  const handlers = enabled ? {
    onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      moved.current = false;
      st.current = { x: e.clientX, y: e.clientY, base: offset.current, active: false, id: e.pointerId };
    },
    onPointerMove(e) {
      const s = st.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { st.current = null; return; }
        if (Math.abs(dx) < 10) return;
        s.active = true;
        moved.current = true;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
      }
      let x = s.base + dx;
      if (x > 0) x = x / 4;
      if (x < -width) x = -width + (x + width) / 4;
      apply(x, false);
    },
    onPointerUp() {
      const s = st.current;
      st.current = null;
      if (!s || !s.active) return;
      const open = offset.current < -width / 2;
      if (open && s.base === 0) haptic('selection');
      apply(open ? -width : 0, true);
    },
    onPointerCancel() {
      if (st.current?.active) apply(offset.current < -width / 2 ? -width : 0, true);
      st.current = null;
    },
    onClickCapture(e) {
      if (e.target.closest('.swipe-actions')) { setTimeout(close, 0); return; }
      // Касание после смахивания не открывает материал.
      if (moved.current || offset.current) {
        e.stopPropagation();
        e.preventDefault();
        moved.current = false;
        if (offset.current) close();
      }
    },
  } : {};

  return { ref, handlers, close };
}
