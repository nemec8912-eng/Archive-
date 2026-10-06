import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Thumb } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useNav } from '../ui.jsx';
import { useActions } from '../actions.js';
import { useBlobUrl } from '../lib/hooks.js';

function Media({ item, active }) {
  const url = useBlobUrl(item?.blobId);
  const videoRef = useRef();
  useEffect(() => {
    if (!active && videoRef.current) videoRef.current.pause();
  }, [active]);
  if (!item) return null;
  if (!url) return <div className="viewer-loading" />;
  if (item.type === 'video') {
    // Встроенный плеер: пауза, перемотка, длительность, полноэкранный режим.
    return <video ref={videoRef} className="viewer-media" src={url} controls playsInline preload="metadata" />;
  }
  return <img className="viewer-media" src={url} alt={item.name} draggable="false" />;
}

// Просмотр фото, скриншотов и видео (ТЗ, п. 7–8).
export default function Viewer({ route }) {
  const store = useStore();
  const nav = useNav();
  const act = useActions();
  const ids = route.ids.filter((id) => store.byId[id] && !store.byId[id].deletedAt);
  const [index, setIndex] = useState(() => Math.max(0, route.index));
  const [chrome, setChrome] = useState(true);
  const touch = useRef(null);
  const stripRef = useRef();

  const safeIndex = Math.min(index, ids.length - 1);
  const item = store.byId[ids[safeIndex]];

  useEffect(() => {
    if (!ids.length) nav.back();
  }, [ids.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    stripRef.current?.querySelector('.strip-item.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [safeIndex]);

  if (!item) return <div className="viewer" />;

  const go = (d) => setIndex((i) => Math.min(ids.length - 1, Math.max(0, Math.min(i, ids.length - 1) + d)));

  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touch.current || e.touches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 80) go(dx < 0 ? 1 : -1);
  };

  const from = Math.max(0, safeIndex - 30);
  const strip = ids.slice(from, safeIndex + 31);

  return (
    <div className={`viewer ${chrome ? '' : 'bare'}`}>
      <header className="viewer-top">
        <button className="icon-btn" onClick={nav.back} aria-label="Назад"><Icon name="back" size={26} /></button>
        <span className="viewer-count">{safeIndex + 1} из {ids.length}</span>
        <button className="icon-btn" onClick={() => act.menu(item, { inViewer: true })} aria-label="Ещё"><Icon name="more" size={24} /></button>
      </header>

      <div
        className="viewer-stage"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={(e) => { if (item.type !== 'video' && e.target.tagName !== 'BUTTON') setChrome((c) => !c); }}
      >
        <Media key={item.id} item={item} active />
        {safeIndex > 0 && (
          <button className="viewer-arrow left" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Предыдущий"><Icon name="back" size={28} /></button>
        )}
        {safeIndex < ids.length - 1 && (
          <button className="viewer-arrow right" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Следующий"><Icon name="chevron" size={28} /></button>
        )}
      </div>

      <footer className="viewer-bottom">
        {ids.length > 1 && (
          <div className="strip" ref={stripRef}>
            {strip.map((id, k) => (
              <button key={id} className={`strip-item ${from + k === safeIndex ? 'on' : ''}`} onClick={() => setIndex(from + k)}>
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
