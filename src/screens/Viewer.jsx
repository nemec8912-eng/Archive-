import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Thumb, Tip } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useNav } from '../ui.jsx';
import { useActions } from '../actions.js';
import { useBlobUrl } from '../lib/hooks.js';
import { haptic } from '../lib/haptics.js';

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function Media({ item, active, onSize }) {
  const url = useBlobUrl(item?.blobId);
  const videoRef = useRef();
  useEffect(() => {
    if (!active && videoRef.current) videoRef.current.pause();
  }, [active]);
  if (!item) return null;
  if (!url) {
    return (
      <div className="viewer-media-wrap">
        <Thumb item={item} className="viewer-under" />
        <div className="viewer-loading" />
      </div>
    );
  }
  if (item.type === 'video') {
    // Встроенный плеер: пауза, перемотка, длительность, полноэкранный режим.
    return <video ref={videoRef} className="viewer-media" src={url} controls playsInline preload="metadata" />;
  }
  return (
    <img
      className="viewer-media"
      src={url}
      alt={item.name}
      draggable="false"
      onLoad={(e) => onSize?.({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
    />
  );
}

// Просмотр фото, скриншотов и видео (ТЗ, п. 7–8) с жестами:
// щипок и двойное касание — приближение, смахивание — листание, потягивание вниз — закрыть.
export default function Viewer({ route }) {
  const store = useStore();
  const nav = useNav();
  const act = useActions();
  const ids = route.ids.filter((id) => store.byId[id] && !store.byId[id].deletedAt);
  const [index, setIndex] = useState(() => Math.max(0, route.index));
  const [chrome, setChrome] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const stripRef = useRef();
  const rootRef = useRef();
  const stageRef = useRef();
  const trackRef = useRef();
  const layerRef = useRef();
  const natural = useRef(null);
  const g = useRef({ ptrs: new Map(), s: 1, x: 0, y: 0, mode: null, lastTap: null, tapTimer: null });

  const safeIndex = Math.min(index, ids.length - 1);
  const item = store.byId[ids[safeIndex]];
  const prevItem = safeIndex > 0 ? store.byId[ids[safeIndex - 1]] : null;
  const nextItem = safeIndex < ids.length - 1 ? store.byId[ids[safeIndex + 1]] : null;
  const isVideo = item?.type === 'video';

  useEffect(() => {
    if (!ids.length) nav.back();
  }, [ids.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    stripRef.current?.querySelector('.strip-item.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [safeIndex]);

  useEffect(() => () => clearTimeout(g.current.tapTimer), []);

  // ── применение трансформаций напрямую к элементам (без лишних перерисовок) ──
  const setLayer = (s, x, y, anim) => {
    const st = g.current;
    st.s = s; st.x = x; st.y = y;
    const el = layerRef.current;
    if (el) {
      el.style.transition = anim ? 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
      el.style.transform = s === 1 && !x && !y ? '' : `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    }
    setZoomed(s > 1.01);
  };
  const setTrack = (dx, anim) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = anim ? 'transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
  };
  const setPull = (dy, anim) => {
    const el = trackRef.current;
    const root = rootRef.current;
    const k = clamp(dy / 500, 0, 1);
    if (el) {
      el.style.transition = anim ? 'transform 0.22s ease-out' : 'none';
      el.style.transform = dy ? `translate3d(0, ${dy}px, 0) scale(${1 - k * 0.25})` : '';
    }
    if (root) {
      root.style.transition = anim ? 'background-color 0.22s ease-out' : 'none';
      root.style.backgroundColor = dy ? `rgba(0,0,0,${1 - k})` : '';
      root.classList.toggle('pulling', dy > 0);
    }
  };

  const resetZoom = (anim = true) => setLayer(1, 0, 0, anim);

  // Пределы сдвига приближенного изображения.
  const bounds = (s) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return { mx: 0, my: 0 };
    let w = stage.width;
    let h = stage.height;
    const n = natural.current;
    if (n?.w && n?.h) {
      const k = Math.min(stage.width / n.w, stage.height / n.h);
      w = n.w * k; h = n.h * k;
    }
    return { mx: Math.max(0, (w * s - stage.width) / 2), my: Math.max(0, (h * s - stage.height) / 2) };
  };

  const go = (d) => {
    const target = safeIndex + d;
    if (target < 0 || target >= ids.length) { setTrack(0, true); return; }
    const w = stageRef.current?.clientWidth || window.innerWidth;
    haptic('selection');
    setTrack(-d * w, true);
    setTimeout(() => {
      natural.current = null;
      resetZoom(false);
      setIndex(target);
      setTrack(0, false);
    }, 230);
  };

  const close = () => {
    setPull(window.innerHeight, true);
    setTimeout(() => nav.back(), 160);
  };

  const center = () => {
    const r = stageRef.current.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  };

  const zoomAt = (px, py, s) => {
    const { cx, cy } = center();
    const st = g.current;
    // точка под пальцем остаётся на месте
    const contentX = (px - cx - st.x) / st.s;
    const contentY = (py - cy - st.y) / st.s;
    let x = px - cx - contentX * s;
    let y = py - cy - contentY * s;
    const b = bounds(s);
    x = clamp(x, -b.mx, b.mx);
    y = clamp(y, -b.my, b.my);
    setLayer(s, x, y, true);
  };

  const onTap = (e) => {
    const st = g.current;
    const now = Date.now();
    const last = st.lastTap;
    if (!isVideo && last && now - last.t < 280 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
      clearTimeout(st.tapTimer);
      st.lastTap = null;
      haptic('light');
      if (st.s > 1.01) resetZoom(); else zoomAt(e.clientX, e.clientY, DOUBLE_TAP_SCALE);
      return;
    }
    st.lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (isVideo) return;
    clearTimeout(st.tapTimer);
    st.tapTimer = setTimeout(() => setChrome((c) => !c), 280);
  };

  const onPointerDown = (e) => {
    if (e.target.closest('button')) return;
    const st = g.current;
    st.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.ptrs.size === 2 && !isVideo) {
      for (const id of st.ptrs.keys()) { try { e.currentTarget.setPointerCapture(id); } catch { /* */ } }
      const [a, b] = [...st.ptrs.values()];
      st.mode = 'pinch';
      st.pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        s: st.s, x: st.x, y: st.y,
      };
      setTrack(0, true);
      setPull(0, true);
    } else if (st.ptrs.size === 1) {
      st.mode = 'pending';
      st.start = { x: e.clientX, y: e.clientY, t: Date.now(), sx: st.x, sy: st.y };
    }
  };

  const onPointerMove = (e) => {
    const st = g.current;
    if (!st.ptrs.has(e.pointerId)) return;
    st.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (st.mode === 'pinch' && st.ptrs.size >= 2) {
      const [a, b] = [...st.ptrs.values()];
      const p = st.pinch;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      let s = p.s * (d / p.d);
      s = s < 1 ? 1 - (1 - s) / 3 : s > MAX_SCALE ? MAX_SCALE + (s - MAX_SCALE) / 4 : s;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const { cx, cy } = center();
      const contentX = (p.mx - cx - p.x) / p.s;
      const contentY = (p.my - cy - p.y) / p.s;
      setLayer(s, mx - cx - contentX * s, my - cy - contentY * s, false);
      return;
    }
    if (!st.start) return;
    const dx = e.clientX - st.start.x;
    const dy = e.clientY - st.start.y;
    if (st.mode === 'pending') {
      if (Math.hypot(dx, dy) < 8) return;
      if (st.s > 1.01) st.mode = 'pan';
      else if (Math.abs(dx) > Math.abs(dy)) st.mode = 'swipe';
      else if (dy > 0) st.mode = 'pull';
      else { st.mode = 'none'; return; }
      // Захватываем палец только когда жест определён — иначе кнопки видеоплеера не получат нажатие.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    }
    if (st.mode === 'pan') {
      const b = bounds(st.s);
      const rub = (v, m) => (v > m ? m + (v - m) / 3 : v < -m ? -m + (v + m) / 3 : v);
      setLayer(st.s, rub(st.start.sx + dx, b.mx), rub(st.start.sy + dy, b.my), false);
    } else if (st.mode === 'swipe') {
      const edge = (dx > 0 && safeIndex === 0) || (dx < 0 && safeIndex === ids.length - 1);
      setTrack(edge ? dx / 3 : dx, false);
    } else if (st.mode === 'pull') {
      setPull(Math.max(0, dy), false);
    }
  };

  const onPointerUp = (e) => {
    const st = g.current;
    if (!st.ptrs.has(e.pointerId)) return;
    st.ptrs.delete(e.pointerId);
    const mode = st.mode;

    if (mode === 'pinch') {
      if (st.ptrs.size === 1) {
        // остался один палец — продолжаем сдвиг
        const [rest] = [...st.ptrs.values()];
        st.mode = 'pan';
        st.start = { x: rest.x, y: rest.y, t: Date.now(), sx: st.x, sy: st.y };
        return;
      }
      st.mode = null;
      if (st.s <= 1.02) resetZoom();
      else {
        const s = Math.min(st.s, MAX_SCALE);
        const b = bounds(s);
        setLayer(s, clamp(st.x, -b.mx, b.mx), clamp(st.y, -b.my, b.my), true);
      }
      return;
    }
    if (st.ptrs.size) return;
    st.mode = null;
    const start = st.start;
    st.start = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dt = Math.max(1, Date.now() - start.t);

    if (mode === 'pending' || !mode) {
      if (Math.hypot(dx, dy) < 10 && dt < 400) onTap(e);
      return;
    }
    if (mode === 'pan') {
      const b = bounds(st.s);
      setLayer(st.s, clamp(st.x, -b.mx, b.mx), clamp(st.y, -b.my, b.my), true);
    } else if (mode === 'swipe') {
      const w = stageRef.current?.clientWidth || window.innerWidth;
      const fast = Math.abs(dx) / dt > 0.5;
      if (dx < 0 && (dx < -w * 0.22 || fast)) go(1);
      else if (dx > 0 && (dx > w * 0.22 || fast)) go(-1);
      else setTrack(0, true);
    } else if (mode === 'pull') {
      if (dy > 110 || (dy > 40 && dy / dt > 0.6)) { haptic('light'); close(); } else setPull(0, true);
    }
  };

  if (!item) return <div className="viewer" />;

  const from = Math.max(0, safeIndex - 30);
  const strip = ids.slice(from, safeIndex + 31);

  return (
    <div ref={rootRef} className={`viewer ${chrome ? '' : 'bare'} ${zoomed ? 'zoomed' : ''}`}>
      <header className="viewer-top">
        <button className="icon-btn" onClick={nav.back} aria-label="Назад"><Icon name="back" size={26} /></button>
        <span className="viewer-count">{safeIndex + 1} из {ids.length}</span>
        <button className="icon-btn" onClick={() => act.menu(item, { inViewer: true })} aria-label="Ещё"><Icon name="more" size={24} /></button>
      </header>

      <div
        ref={stageRef}
        className={`viewer-stage ${isVideo ? 'is-video' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="viewer-track" ref={trackRef}>
          {prevItem && <div className="viewer-slide prev"><Media key={prevItem.id} item={prevItem} /></div>}
          <div className="viewer-slide">
            <div className="viewer-layer" ref={layerRef}>
              <Media key={item.id} item={item} active onSize={(n) => { natural.current = n; }} />
            </div>
          </div>
          {nextItem && <div className="viewer-slide next"><Media key={nextItem.id} item={nextItem} /></div>}
        </div>
        {safeIndex > 0 && (
          <button className="viewer-arrow left" onClick={() => go(-1)} aria-label="Предыдущий"><Icon name="back" size={28} /></button>
        )}
        {safeIndex < ids.length - 1 && (
          <button className="viewer-arrow right" onClick={() => go(1)} aria-label="Следующий"><Icon name="chevron" size={28} /></button>
        )}
      </div>

      <footer className="viewer-bottom">
        <div className="viewer-tip"><Tip id="viewer-gestures" icon="hand">Двойное касание или щипок — приблизить. Потяните вниз, чтобы закрыть.</Tip></div>
        {item.caption && <p className="viewer-caption">{item.caption}</p>}
        {ids.length > 1 && (
          <div className="strip" ref={stripRef}>
            {strip.map((id, k) => (
              <button key={id} className={`strip-item ${from + k === safeIndex ? 'on' : ''}`} onClick={() => { natural.current = null; resetZoom(false); setIndex(from + k); }}>
                <Thumb item={store.byId[id]} />
              </button>
            ))}
          </div>
        )}
        <div className="action-bar">
          <button onClick={() => act.share(item)}><Icon name="share" size={22} /><span>Поделиться</span></button>
          <button className={item.favorite ? 'on' : ''} onClick={() => act.toggleFav([item.id], !item.favorite)}>
            <Icon name={item.favorite ? 'heartFill' : 'heart'} size={22} /><span>{item.favorite ? 'В избранном' : 'В избранное'}</span>
          </button>
          <button onClick={() => act.remove([item.id])}><Icon name="trash" size={22} /><span>Удалить</span></button>
          <button onClick={() => act.menu(item, { inViewer: true })}><Icon name="more" size={22} /><span>Ещё</span></button>
        </div>
      </footer>
    </div>
  );
}
