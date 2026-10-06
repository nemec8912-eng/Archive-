import { useEffect, useRef, useState } from 'react';
import { getBlob } from './db.js';
import { haptic } from './haptics.js';

const thumbCache = new Map();
let generation = 0;

// При блокировке временные ссылки на расшифрованные миниатюры уничтожаются.
export function clearThumbCache() {
  thumbCache.forEach((u) => URL.revokeObjectURL(u));
  thumbCache.clear();
  generation += 1;
}

// Возвращает временную ссылку на файл из хранилища устройства.
export function useBlobUrl(id, { cache = false, enabled = true } = {}) {
  const [url, setUrl] = useState(() => (id && cache ? thumbCache.get(id) : null) || null);
  useEffect(() => {
    if (!id || !enabled) { setUrl(null); return undefined; }
    if (cache && thumbCache.has(id)) { setUrl(thumbCache.get(id)); return undefined; }
    let alive = true;
    let made;
    const gen = generation;
    getBlob(id).then((b) => {
      if (!b || !alive || gen !== generation) return;
      made = URL.createObjectURL(b);
      if (cache) thumbCache.set(id, made);
      setUrl(made);
    }).catch(() => {});
    return () => {
      alive = false;
      if (made && !cache) URL.revokeObjectURL(made);
    };
  }, [id, cache, enabled]);
  return url;
}

export function useInView(margin = '300px') {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    if (!('IntersectionObserver' in window)) { setSeen(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: margin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen];
}

// Короткое нажатие — onClick, удержание — onLong.
// drag (необязательно): после удержания движение пальца начинает перетаскивание.
export function useLongPress(onLong, onClick, ms = 450, drag = null) {
  const timer = useRef();
  const fired = useRef(false);
  const dragging = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const unblock = useRef(null);
  const release = () => { unblock.current?.(); unblock.current = null; };
  const clear = () => clearTimeout(timer.current);
  // После удержания прокрутка страницы блокируется, чтобы палец мог тащить материал.
  const blockScroll = () => {
    const stop = (e) => e.preventDefault();
    document.addEventListener('touchmove', stop, { passive: false });
    unblock.current = () => document.removeEventListener('touchmove', stop);
  };
  return {
    onPointerDown(e) {
      fired.current = false;
      dragging.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      if (drag && e.pointerType === 'mouse') { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ } }
      timer.current = setTimeout(() => {
        fired.current = true;
        haptic('medium');
        if (drag) blockScroll();
        onLong?.();
      }, ms);
    },
    onPointerMove(e) {
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (dragging.current) { drag.onMove(e.clientX, e.clientY); return; }
      if (fired.current && drag && Math.hypot(dx, dy) > 14) {
        dragging.current = true;
        drag.onStart(e.clientX, e.clientY);
        return;
      }
      if (!fired.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) clear();
    },
    onPointerUp(e) {
      clear();
      release();
      if (dragging.current) { dragging.current = false; drag.onEnd(e.clientX, e.clientY); }
    },
    onPointerCancel() {
      clear();
      release();
      if (dragging.current) { dragging.current = false; drag.onEnd(null, null); }
    },
    onPointerLeave() { if (!dragging.current && !(drag && fired.current)) clear(); },
    onContextMenu(e) { e.preventDefault(); },
    onClick(e) {
      if (fired.current) { e.preventDefault(); return; }
      onClick?.(e);
    },
  };
}
