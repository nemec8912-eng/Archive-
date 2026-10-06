import { useEffect, useRef, useState } from 'react';
import { getBlob } from './db.js';
import { haptic } from './haptics.js';

const thumbCache = new Map();

// Возвращает временную ссылку на файл из хранилища устройства.
export function useBlobUrl(id, { cache = false, enabled = true } = {}) {
  const [url, setUrl] = useState(() => (id && cache ? thumbCache.get(id) : null) || null);
  useEffect(() => {
    if (!id || !enabled) { setUrl(null); return undefined; }
    if (cache && thumbCache.has(id)) { setUrl(thumbCache.get(id)); return undefined; }
    let alive = true;
    let made;
    getBlob(id).then((b) => {
      if (!b || !alive) return;
      made = URL.createObjectURL(b);
      if (cache) thumbCache.set(id, made);
      setUrl(made);
    });
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
export function useLongPress(onLong, onClick, ms = 450) {
  const timer = useRef();
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const clear = () => clearTimeout(timer.current);
  return {
    onPointerDown(e) {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        haptic('medium');
        onLong?.();
      }, ms);
    },
    onPointerMove(e) {
      if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu(e) { e.preventDefault(); },
    onClick(e) {
      if (fired.current) { e.preventDefault(); return; }
      onClick?.(e);
    },
  };
}
