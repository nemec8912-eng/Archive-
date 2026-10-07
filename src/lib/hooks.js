import { useEffect, useRef, useState } from 'react';
import { getBlob } from './db.js';
import { haptic } from './haptics.js';

// Кэш миниатюр: id → { url, users }. Порядок в Map — от давно использованных к недавним.
// На большом архиве хранится не больше THUMB_LIMIT ссылок: лишние, которые сейчас нигде не показаны, освобождаются.
const thumbCache = new Map();
const THUMB_LIMIT = 400;
let generation = 0;

// При блокировке временные ссылки на расшифрованные миниатюры уничтожаются.
export function clearThumbCache() {
  thumbCache.forEach((e) => URL.revokeObjectURL(e.url));
  thumbCache.clear();
  generation += 1;
}

function takeThumb(id) {
  const e = thumbCache.get(id);
  if (!e) return null;
  thumbCache.delete(id);
  thumbCache.set(id, e); // в конец — недавно использована
  e.users += 1;
  return e.url;
}

function releaseThumb(id) {
  const e = thumbCache.get(id);
  if (e) e.users = Math.max(0, e.users - 1);
  if (thumbCache.size <= THUMB_LIMIT) return;
  for (const [k, v] of thumbCache) {
    if (thumbCache.size <= THUMB_LIMIT) break;
    if (v.users === 0) { URL.revokeObjectURL(v.url); thumbCache.delete(k); }
  }
}

// Возвращает временную ссылку на файл из хранилища устройства.
export function useBlobUrl(id, { cache = false, enabled = true } = {}) {
  const [url, setUrl] = useState(() => (id && cache ? thumbCache.get(id)?.url : null) || null);
  useEffect(() => {
    if (!id || !enabled) { setUrl(null); return undefined; }
    if (cache) {
      const hit = takeThumb(id);
      if (hit) { setUrl(hit); return () => releaseThumb(id); }
    }
    let alive = true;
    let made;
    let held = false;
    const gen = generation;
    getBlob(id).then((b) => {
      if (!b || !alive || gen !== generation) return;
      if (cache) {
        const hit = takeThumb(id); // пока читали, ту же миниатюру мог загрузить соседний экран
        if (hit) { held = true; setUrl(hit); return; }
        made = URL.createObjectURL(b);
        thumbCache.set(id, { url: made, users: 1 });
        held = true;
      } else {
        made = URL.createObjectURL(b);
      }
      setUrl(made);
    }).catch(() => {});
    return () => {
      alive = false;
      if (cache) { if (held) releaseThumb(id); } else if (made) URL.revokeObjectURL(made);
    };
  }, [id, cache, enabled]);
  return url;
}

// Длинные списки рисуются частями: сначала первые step, остальное — по мере прокрутки.
// Возвращает [сколько показать, ref для отметки в конце списка].
export function useProgressive(total, step = 120, resetKey = '') {
  const [count, setCount] = useState(step);
  const ref = useRef(null);
  useEffect(() => { setCount(step); }, [resetKey, step]);
  useEffect(() => {
    if (count >= total || !ref.current) return undefined;
    if (!('IntersectionObserver' in window)) { setCount(total); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(total, c + step));
    }, { rootMargin: '1200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [count, total, step]);
  return [Math.min(count, total), ref];
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
