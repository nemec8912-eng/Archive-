import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useStore } from '../store.jsx';
import { useNav, useUi } from '../ui.jsx';
import { getBlob } from '../lib/db.js';
import { importFile } from '../lib/media.js';
import { fmtDur } from '../lib/format.js';
import { haptic } from '../lib/haptics.js';
import { trimMp4 } from '../lib/mp4trim.js';

const MAX_SIDE = 4096; // предел рабочего размера фото, чтобы не переполнить память телефона
// На iPhone память под холсты у WebView заметно меньше — ограничиваем ещё и число точек.
const IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const MAX_PIXELS = IOS ? 8_000_000 : 16_000_000;
// Освободить память холста сразу (iPhone держит её, пока у холста есть размер).
const freeCanvas = (c) => { if (c) { c.width = 0; c.height = 0; } };
const ASPECTS = [
  { id: 'free', label: 'Свободно', r: null },
  { id: '1', label: '1:1', r: 1 },
  { id: '4:3', label: '4:3', r: 4 / 3 },
  { id: '3:4', label: '3:4', r: 3 / 4 },
  { id: '16:9', label: '16:9', r: 16 / 9 },
  { id: '9:16', label: '9:16', r: 9 / 16 },
];
const BRUSHES = [{ id: 's', label: 'S', k: 0.025 }, { id: 'm', label: 'M', k: 0.045 }, { id: 'l', label: 'L', k: 0.08 }];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Размер области, в которую вписывается материал.
function useFit(stageRef, w, h) {
  const [fit, setFit] = useState(null);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || !w || !h) return undefined;
    const calc = () => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / w, r.height / h);
      setFit({ k, w: w * k, h: h * k });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageRef, w, h]);
  return fit;
}

// Рамка обрезки с ручками; координаты — в пикселях исходника.
function CropBox({ rect, W, H, aspect, k, onChange }) {
  const drag = useRef(null);
  const MIN = Math.max(24, Math.min(W, H) * 0.05);

  const down = (mode) => (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, r: { ...rect } };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / k;
    const dy = (e.clientY - d.y) / k;
    let { x, y, w, h } = d.r;
    if (d.mode === 'move') {
      x = clamp(x + dx, 0, W - w);
      y = clamp(y + dy, 0, H - h);
    } else {
      const m = d.mode;
      let x2 = x + w;
      let y2 = y + h;
      if (m.includes('w')) x = clamp(x + dx, 0, x2 - MIN);
      if (m.includes('e')) x2 = clamp(x2 + dx, x + MIN, W);
      if (m.includes('n')) y = clamp(y + dy, 0, y2 - MIN);
      if (m.includes('s')) y2 = clamp(y2 + dy, y + MIN, H);
      w = x2 - x;
      h = y2 - y;
      if (aspect) {
        // сохраняем пропорцию, подгоняя высоту под ширину
        let nh = w / aspect;
        if (m.includes('n')) { y = y2 - nh; if (y < 0) { y = 0; nh = y2; w = nh * aspect; if (m.includes('w')) x = x2 - w; } }
        else if (y + nh > H) { nh = H - y; w = nh * aspect; if (m.includes('w')) x = x2 - w; }
        h = nh;
      }
    }
    onChange({ x, y, w, h });
  };
  const up = () => { drag.current = null; };

  const style = { left: rect.x * k, top: rect.y * k, width: rect.w * k, height: rect.h * k };
  const handlers = { onPointerMove: move, onPointerUp: up, onPointerCancel: up };
  return (
    <div className="crop-box" style={style} onPointerDown={down('move')} {...handlers}>
      <i className="crop-grid v1" /><i className="crop-grid v2" /><i className="crop-grid h1" /><i className="crop-grid h2" />
      {['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].map((m) => (
        <span key={m} className={`crop-h ${m}`} onPointerDown={down(m)} {...handlers} />
      ))}
    </div>
  );
}

function aspectRect(W, H, r) {
  if (!r) return { x: 0, y: 0, w: W, h: H };
  let w = W;
  let h = W / r;
  if (h > H) { h = H; w = H * r; }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

const isFull = (c, W, H) => c.x < 1 && c.y < 1 && Math.abs(c.w - W) < 1 && Math.abs(c.h - H) < 1;

// ── Фото и скриншоты: обрезка и замазывание ──
function ImageEditor({ item, onSave, onCancel }) {
  const [img, setImg] = useState(null); // { src: canvas с исходником, W, H }
  const [tab, setTab] = useState(item.type === 'screenshot' ? 'mask' : 'crop');
  const [aspect, setAspect] = useState('free');
  const [crop, setCrop] = useState(null);
  const [strokes, setStrokes] = useState([]);
  const [brush, setBrush] = useState('m');
  const [mode, setMode] = useState('pixel');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const stageRef = useRef();
  const viewRef = useRef();
  const mosaic = useRef(null);
  const cur = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const blob = await getBlob(item.blobId);
      if (!blob || !alive) return;
      let bmp;
      try { bmp = await createImageBitmap(blob); } catch {
        bmp = await new Promise((res, rej) => {
          const u = URL.createObjectURL(blob);
          const im = new Image();
          im.onload = () => { URL.revokeObjectURL(u); res(im); };
          im.onerror = rej;
          im.src = u;
        });
      }
      const w0 = bmp.width || bmp.naturalWidth;
      const h0 = bmp.height || bmp.naturalHeight;
      const s = Math.min(1, MAX_SIDE / Math.max(w0, h0), Math.sqrt(MAX_PIXELS / (w0 * h0)));
      const W = Math.round(w0 * s);
      const H = Math.round(h0 * s);
      const src = document.createElement('canvas');
      src.width = W; src.height = H;
      src.getContext('2d').drawImage(bmp, 0, 0, W, H);
      bmp.close?.();
      // мозаика для замазывания
      const block = Math.max(8, Math.round(Math.min(W, H) / 36));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(W / block));
      small.height = Math.max(1, Math.round(H / block));
      small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
      // Мозаика хранится маленькой и растягивается при рисовании — без ещё одного холста во весь размер.
      mosaic.current = small;
      if (!alive) { freeCanvas(src); freeCanvas(small); return; }
      setImg({ src, W, H });
      setCrop({ x: 0, y: 0, w: W, h: H });
    })().catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [item.blobId]);

  // При выходе из редактора память холстов отдаём сразу.
  useEffect(() => () => { freeCanvas(img?.src); freeCanvas(mosaic.current); freeCanvas(viewRef.current); }, [img]);

  const fit = useFit(stageRef, img?.W, img?.H);

  const paintStroke = useCallback((ctx, st, from = 0) => {
    const r = (BRUSHES.find((b) => b.id === st.brush) || BRUSHES[1]).k * Math.min(img.W, img.H);
    const pts = st.points;
    ctx.save();
    ctx.beginPath();
    for (let i = Math.max(1, from); i < pts.length || i === 1; i++) {
      const a = pts[i - 1] || pts[0];
      const b = pts[i] || a;
      const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(dist / (r / 3)));
      for (let j = 0; j <= n; j++) {
        const x = a[0] + ((b[0] - a[0]) * j) / n;
        const y = a[1] + ((b[1] - a[1]) * j) / n;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      if (i >= pts.length) break;
    }
    ctx.clip();
    if (st.mode === 'pixel') { ctx.imageSmoothingEnabled = false; ctx.drawImage(mosaic.current, 0, 0, img.W, img.H); }
    else { ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, img.W, img.H); }
    ctx.restore();
  }, [img]);

  // Перерисовка по списку мазков (после отмены).
  useEffect(() => {
    const c = viewRef.current;
    if (!c || !img) return;
    c.width = img.W; c.height = img.H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img.src, 0, 0);
    strokes.forEach((st) => paintStroke(ctx, st));
  }, [img, strokes, paintStroke, !!fit]); // eslint-disable-line react-hooks/exhaustive-deps

  const toImg = (e) => {
    const r = viewRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * img.W, ((e.clientY - r.top) / r.height) * img.H];
  };
  const maskDown = (e) => {
    if (tab !== 'mask') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cur.current = { mode, brush, points: [toImg(e)] };
    paintStroke(viewRef.current.getContext('2d'), cur.current);
  };
  const maskMove = (e) => {
    const st = cur.current;
    if (!st) return;
    st.points.push(toImg(e));
    paintStroke(viewRef.current.getContext('2d'), st, st.points.length - 1);
  };
  const maskUp = () => {
    const st = cur.current;
    cur.current = null;
    if (st) setStrokes((l) => [...l, st]);
  };

  const pickAspect = (a) => {
    haptic('selection');
    setAspect(a.id);
    setCrop(aspectRect(img.W, img.H, a.r));
  };

  const changed = img && (strokes.length > 0 || !isFull(crop, img.W, img.H));

  const save = async () => {
    setBusy(true);
    const c = viewRef.current;
    const out = document.createElement('canvas');
    out.width = Math.round(crop.w);
    out.height = Math.round(crop.h);
    out.getContext('2d').drawImage(c, -Math.round(crop.x), -Math.round(crop.y));
    const png = item.type === 'screenshot' || /png/i.test(item.mime || '');
    const blob = await new Promise((res) => out.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.92));
    freeCanvas(out);
    setBusy(false);
    if (blob) onSave(blob, png ? 'png' : 'jpg');
  };

  const a = ASPECTS.find((x) => x.id === aspect);
  return (
    <>
      <div className="editor-stage" ref={stageRef}>
        {!img && !loadError && <div className="viewer-loading" />}
        {loadError && <p className="error-text">Не удалось открыть снимок: он слишком большой для этого устройства или повреждён.</p>}
        {img && fit && (
          <div className="editor-canvas" style={{ width: fit.w, height: fit.h }}>
            <canvas
              ref={viewRef}
              className={tab === 'mask' ? 'masking' : ''}
              onPointerDown={maskDown}
              onPointerMove={maskMove}
              onPointerUp={maskUp}
              onPointerCancel={maskUp}
            />
            {tab === 'crop' && crop && (
              <>
                <div className="crop-shade" style={{ clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${crop.x * fit.k}px ${crop.y * fit.k}px, ${crop.x * fit.k}px ${(crop.y + crop.h) * fit.k}px, ${(crop.x + crop.w) * fit.k}px ${(crop.y + crop.h) * fit.k}px, ${(crop.x + crop.w) * fit.k}px ${crop.y * fit.k}px, ${crop.x * fit.k}px ${crop.y * fit.k}px)` }} />
                <CropBox rect={crop} W={img.W} H={img.H} aspect={a.r} k={fit.k} onChange={setCrop} />
              </>
            )}
          </div>
        )}
      </div>
      <div className="editor-tools">
        {tab === 'crop' ? (
          <div className="chips editor-chips">
            {ASPECTS.map((x) => (
              <button key={x.id} className={`chip ${aspect === x.id ? 'on' : ''}`} onClick={() => pickAspect(x)}>{x.label}</button>
            ))}
            <button className="chip" onClick={() => { setAspect('free'); setCrop({ x: 0, y: 0, w: img.W, h: img.H }); }}>Сбросить</button>
          </div>
        ) : (
          <div className="mask-tools">
            <div className="seg">
              <button className={mode === 'pixel' ? 'on' : ''} onClick={() => setMode('pixel')}>Пиксели</button>
              <button className={mode === 'fill' ? 'on' : ''} onClick={() => setMode('fill')}>Заливка</button>
            </div>
            <div className="seg">
              {BRUSHES.map((b) => <button key={b.id} className={brush === b.id ? 'on' : ''} onClick={() => setBrush(b.id)} aria-label={`Кисть ${b.label}`}>{b.label}</button>)}
            </div>
            <button className="icon-btn" disabled={!strokes.length} onClick={() => { haptic('light'); setStrokes((l) => l.slice(0, -1)); }} aria-label="Отменить мазок"><Icon name="undo" size={22} /></button>
          </div>
        )}
        <div className="seg editor-tabs">
          <button className={tab === 'crop' ? 'on' : ''} onClick={() => setTab('crop')}><Icon name="crop" size={18} />Обрезка</button>
          <button className={tab === 'mask' ? 'on' : ''} onClick={() => setTab('mask')}><Icon name="brush" size={18} />Замазать</button>
        </div>
        <div className="editor-actions">
          <button className="btn ghost" onClick={onCancel}>Отмена</button>
          <button className="btn primary" disabled={!changed || busy} onClick={save}>{busy ? 'Сохранение…' : 'Готово'}</button>
        </div>
      </div>
    </>
  );
}

function pickVideoMime() {
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return list.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

// ── Видео: обрезка по времени и по кадру ──
function VideoEditor({ item, onSave, onCancel }) {
  const [url, setUrl] = useState(null);
  const [meta, setMeta] = useState(null); // { W, H, dur }
  const [range, setRange] = useState([0, 0]);
  const [crop, setCrop] = useState(null);
  const [aspect, setAspect] = useState('free');
  const [frames, setFrames] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const stageRef = useRef();
  const videoRef = useRef();
  const trackRef = useRef();
  const cancel = useRef(false);

  useEffect(() => {
    let made;
    getBlob(item.blobId).then((b) => { if (b) { made = URL.createObjectURL(b); setUrl(made); } });
    return () => made && URL.revokeObjectURL(made);
  }, [item.blobId]);

  const onMeta = () => {
    const v = videoRef.current;
    const m = { W: v.videoWidth, H: v.videoHeight, dur: v.duration };
    setMeta(m);
    setRange([0, m.dur]);
    setCrop({ x: 0, y: 0, w: m.W, h: m.H });
    makeFrames(m);
  };

  // Кадры для дорожки обрезки.
  const makeFrames = async (m) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((r) => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 4000); });
    const n = 8;
    const out = [];
    const c = document.createElement('canvas');
    c.height = 64; c.width = Math.round((64 * m.W) / Math.max(1, m.H));
    for (let i = 0; i < n; i++) {
      await new Promise((r) => { v.onseeked = r; v.currentTime = Math.min(m.dur - 0.05, (m.dur * (i + 0.5)) / n); setTimeout(r, 1500); });
      try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); out.push(c.toDataURL('image/jpeg', 0.6)); } catch { /* */ }
      setFrames([...out]);
    }
  };

  const fit = useFit(stageRef, meta?.W, meta?.H);

  // Предпросмотр в пределах выбранного отрезка.
  const onTime = () => {
    const v = videoRef.current;
    if (v && !progress && v.currentTime > range[1]) { v.pause(); v.currentTime = range[0]; }
  };

  const dragHandle = (which) => (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = trackRef.current.getBoundingClientRect();
    const mv = (ev) => {
      const t = clamp(((ev.clientX - r.left) / r.width) * meta.dur, 0, meta.dur);
      setRange(([s, en]) => {
        const next = which === 0 ? [Math.min(t, en - 0.3), en] : [s, Math.max(t, s + 0.3)];
        if (videoRef.current) videoRef.current.currentTime = next[which];
        return next;
      });
    };
    const upH = () => { e.target.removeEventListener('pointermove', mv); e.target.removeEventListener('pointerup', upH); };
    e.target.addEventListener('pointermove', mv);
    e.target.addEventListener('pointerup', upH);
  };

  const changed = meta && crop && (range[0] > 0.05 || range[1] < meta.dur - 0.05 || !isFull(crop, meta.W, meta.H));

  // Только обрезка по времени — без перекодирования: быстро, без потери качества, на любом телефоне.
  // Обрезка кадра (или необычный файл) — перекодирование на устройстве.
  const exportVideo = async () => {
    setError('');
    // Звук для перекодирования включаем сразу по нажатию — иначе iPhone может его не пустить.
    const AC = window.AudioContext || window.webkitAudioContext;
    let actx = null;
    try { actx = AC ? new AC() : null; actx?.resume?.(); } catch { actx = null; }
    if (isFull(crop, meta.W, meta.H)) {
      setProgress(-1);
      try {
        const src = await getBlob(item.blobId);
        const out = await trimMp4(src, range[0], range[1]);
        actx?.close?.();
        setProgress(null);
        const ext = (item.name.match(/\.([a-z0-9]{2,4})$/i)?.[1] || (/quicktime/.test(src.type) ? 'mov' : 'mp4')).toLowerCase();
        onSave(out, ext);
        return;
      } catch (e) {
        setProgress(null);
        if (e?.code !== 'unsupported') { actx?.close?.(); setError('Не удалось обрезать видео'); return; }
      }
    }
    await reencode(actx);
  };

  // Перекодирование на устройстве: кадр рисуется на холст и записывается вместе со звуком.
  const reencode = async (actx) => {
    const mime = pickVideoMime();
    const canvasProto = HTMLCanvasElement.prototype;
    if (!window.MediaRecorder || !canvasProto.captureStream) { actx?.close?.(); setError('Это устройство не умеет перекодировать видео'); return; }
    cancel.current = false;
    setProgress(0);
    const v = document.createElement('video');
    v.src = url; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    await new Promise((r) => { v.onloadeddata = r; v.onerror = r; });
    const scale = Math.min(1, 1920 / Math.max(crop.w, crop.h));
    const cw = Math.max(2, Math.round((crop.w * scale) / 2) * 2);
    const ch = Math.max(2, Math.round((crop.h * scale) / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    try {
      if (!actx) throw new Error('нет звука');
      const srcNode = actx.createMediaElementSource(v);
      const dest = actx.createMediaStreamDestination();
      srcNode.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch { /* без звука */ }
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    v.currentTime = range[0];
    await new Promise((r) => { v.onseeked = r; setTimeout(r, 2000); });
    let raf;
    const draw = () => {
      ctx.drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);
      setProgress(clamp((v.currentTime - range[0]) / (range[1] - range[0]), 0, 1));
      if (cancel.current || v.currentTime >= range[1] || v.ended) {
        v.pause();
        if (rec.state !== 'inactive') rec.stop();
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    rec.start(250);
    await v.play().catch(() => {});
    draw();
    await done;
    cancelAnimationFrame(raf);
    actx?.close?.();
    stream.getTracks().forEach((t) => t.stop());
    if (cancel.current) { setProgress(null); return; }
    const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
    setProgress(null);
    onSave(new Blob(chunks, { type }), type.includes('mp4') ? 'mp4' : 'webm');
  };

  const a = ASPECTS.find((x) => x.id === aspect);
  return (
    <>
      <div className="editor-stage" ref={stageRef}>
        {!meta && <div className="viewer-loading" />}
        <div className="editor-canvas" style={fit ? { width: fit.w, height: fit.h } : { width: 1, height: 1, opacity: 0 }}>
          {url && (
            <video ref={videoRef} src={url} playsInline preload="auto" onLoadedMetadata={onMeta} onTimeUpdate={onTime}
              onClick={() => { const v = videoRef.current; if (v.paused) { if (v.currentTime < range[0] || v.currentTime >= range[1]) v.currentTime = range[0]; v.play(); } else v.pause(); }} />
          )}
          {fit && crop && (
            <>
              <div className="crop-shade" style={{ clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${crop.x * fit.k}px ${crop.y * fit.k}px, ${crop.x * fit.k}px ${(crop.y + crop.h) * fit.k}px, ${(crop.x + crop.w) * fit.k}px ${(crop.y + crop.h) * fit.k}px, ${(crop.x + crop.w) * fit.k}px ${crop.y * fit.k}px, ${crop.x * fit.k}px ${crop.y * fit.k}px)` }} />
              <CropBox rect={crop} W={meta.W} H={meta.H} aspect={a.r} k={fit.k} onChange={setCrop} />
            </>
          )}
        </div>
      </div>
      <div className="editor-tools">
        {meta && (
          <div className="trim">
            <div className="trim-track" ref={trackRef}>
              <div className="trim-frames">{frames.map((f, i) => <img key={i} src={f} alt="" />)}</div>
              <div className="trim-dim" style={{ left: 0, width: `${(range[0] / meta.dur) * 100}%` }} />
              <div className="trim-dim" style={{ right: 0, width: `${(1 - range[1] / meta.dur) * 100}%` }} />
              <div className="trim-sel" style={{ left: `${(range[0] / meta.dur) * 100}%`, right: `${(1 - range[1] / meta.dur) * 100}%` }}>
                <span className="trim-h l" onPointerDown={dragHandle(0)} />
                <span className="trim-h r" onPointerDown={dragHandle(1)} />
              </div>
            </div>
            <div className="trim-times"><span>{fmtDur(range[0])}</span><b>{fmtDur(range[1] - range[0])}</b><span>{fmtDur(range[1])}</span></div>
          </div>
        )}
        <div className="chips editor-chips">
          {ASPECTS.map((x) => (
            <button key={x.id} className={`chip ${aspect === x.id ? 'on' : ''}`} onClick={() => { setAspect(x.id); setCrop(aspectRect(meta.W, meta.H, x.r)); }}>{x.label}</button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
        {progress === -1 ? (
          <div className="export-progress"><p className="muted">Обрезка видео…</p></div>
        ) : progress != null ? (
          <div className="export-progress">
            <div className="storage-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="muted">Обработка видео… {Math.round(progress * 100)}%. Занимает столько же времени, сколько длится отрывок.</p>
            <button className="btn ghost" onClick={() => { cancel.current = true; }}>Остановить</button>
          </div>
        ) : (
          <div className="editor-actions">
            <button className="btn ghost" onClick={onCancel}>Отмена</button>
            <button className="btn primary" disabled={!changed} onClick={exportVideo}>Готово</button>
          </div>
        )}
      </div>
    </>
  );
}

// Встроенный редактор (обрезка фото и видео, замазывание лишнего на скриншоте).
export default function Editor({ route }) {
  const store = useStore();
  const nav = useNav();
  const ui = useUi();
  const item = store.byId[route.id];

  useEffect(() => {
    if (!item || item.deletedAt) nav.back();
  }, [item?.deletedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return <div className="editor" />;

  const finish = async (blob, ext, replace) => {
    ui.showToast('Сохранение…', null, 0);
    const baseName = item.name.replace(/\.[^.]+$/, '');
    const file = new File([blob], `${baseName}${replace ? '' : '_изм'}.${ext}`, { type: blob.type });
    const next = await importFile(file, item.type, item.folderId);
    next.type = item.type;
    if (item.caption) next.caption = item.caption;
    if (replace) {
      next.createdAt = item.createdAt;
      next.favorite = item.favorite;
      store.addItems([next]);
      store.trash([item.id]);
      haptic('success');
      ui.showToast('Изменения сохранены, оригинал — в корзине', { label: 'Вернуть', run: () => { store.restore([item.id]); store.trash([next.id]); } });
    } else {
      store.addItems([next]);
      haptic('success');
      ui.showToast('Сохранено как копия');
    }
    nav.back();
  };

  const onSave = (blob, ext) =>
    ui.open({
      type: 'menu',
      title: 'Сохранить изменения',
      actions: [
        { icon: 'copy', label: 'Сохранить как копию', run: () => finish(blob, ext, false) },
        { icon: 'restore', label: 'Заменить оригинал', value: 'оригинал — в корзину', run: () => finish(blob, ext, true) },
      ],
    });

  const props = { item, onSave, onCancel: nav.back };
  return (
    <div className="editor">
      <header className="editor-top">
        <button className="icon-btn" onClick={nav.back} aria-label="Закрыть"><Icon name="close" size={24} /></button>
        <span className="editor-title">{item.type === 'video' ? 'Обрезка видео' : 'Редактор'}</span>
        <span className="icon-btn" />
      </header>
      {item.type === 'video' ? <VideoEditor {...props} /> : <ImageEditor {...props} />}
    </div>
  );
}
