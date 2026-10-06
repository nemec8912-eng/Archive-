import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { useNav, useUi } from '../ui.jsx';
import { usePrefs } from '../prefs.jsx';
import { haptic } from '../lib/haptics.js';
import { useRowSwipe } from '../lib/gestures.js';
import { useBlobUrl, useInView, useLongPress } from '../lib/hooks.js';
import { fmtDur, fmtDate, fmtSize } from '../lib/format.js';
import { CATEGORY } from '../lib/categories.js';

export function TopBar({ title, sub, left, right, back = true, center = true }) {
  const nav = useNav();
  return (
    <header className={`topbar ${center ? 'center' : ''}`}>
      <div className="tb-side">
        {left || (back && (
          <button className="icon-btn" onClick={nav.back} aria-label="Назад"><Icon name="back" size={24} /></button>
        ))}
      </div>
      <div className="tb-title">
        <h2>{title}</h2>
        {sub && <small>{sub}</small>}
      </div>
      <div className="tb-side right">{right}</div>
    </header>
  );
}

export function BottomNav() {
  const nav = useNav();
  const ui = useUi();
  const tab = nav.tab;
  const btn = (name, icon, label) => (
    <button className={`nav-btn ${tab === name ? 'active' : ''}`} onClick={() => nav.goTab(name)}>
      <Icon name={tab === name && icon === 'folder' ? 'folderFill' : tab === name && icon === 'star' ? 'starFill' : icon} size={23} />
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="bottom-nav">
      {btn('home', 'home', 'Главная')}
      {btn('folders', 'folder', 'Папки')}
      <button className="nav-add" onClick={() => { haptic('light'); ui.open({ type: 'add' }); }} aria-label="Добавить">
        <Icon name="plus" size={28} />
      </button>
      {btn('favorites', 'star', 'Избранное')}
      {btn('settings', 'gear', 'Настройки')}
    </nav>
  );
}

export function TypeIcon({ type, size = 22 }) {
  return <Icon name={CATEGORY[type]?.icon || 'note'} size={size} />;
}

function MiniWave({ data = [], bars = 22 }) {
  const step = Math.max(1, Math.floor(data.length / bars));
  const pts = [];
  for (let i = 0; i < data.length && pts.length < bars; i += step) pts.push(data[i]);
  return (
    <div className="mini-wave">
      {pts.map((v, i) => <i key={i} style={{ height: `${Math.round(v * 100)}%` }} />)}
    </div>
  );
}

// Миниатюра загружается из хранилища устройства; пока её нет — мерцающий скелетон.
function ThumbImg({ url }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <div className="skeleton" />}
      <img src={url} alt="" draggable="false" className={loaded ? 'loaded' : ''} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
    </>
  );
}

export function Thumb({ item, className = '' }) {
  const [ref, seen] = useInView();
  const url = useBlobUrl(item.thumbId, { cache: true, enabled: seen });
  if (item.type === 'photo' || item.type === 'screenshot' || item.type === 'video') {
    return (
      <div ref={ref} className={`thumb ${className}`}>
        {url ? <ThumbImg key={url} url={url} /> : item.thumbId ? <div className="skeleton" /> : <div className="thumb-ph"><TypeIcon type={item.type} size={26} /></div>}
        {item.type === 'video' && (
          <span className="badge"><Icon name="videoCam" size={14} />{item.duration ? fmtDur(item.duration) : ''}</span>
        )}
      </div>
    );
  }
  if (item.type === 'voice') {
    return (
      <div ref={ref} className={`thumb thumb-voice ${className}`}>
        <MiniWave data={item.waveform} />
        <span className="badge plain"><Icon name="mic" size={13} />{fmtDur(item.duration)}</span>
      </div>
    );
  }
  if (item.type === 'note') {
    return (
      <div ref={ref} className={`thumb thumb-text ${className}`}>
        <Icon name="note" size={18} />
        <p>{(item.text || '').slice(0, 90) || 'Пустая заметка'}</p>
      </div>
    );
  }
  return (
    <div ref={ref} className={`thumb thumb-text ${className}`}>
      <Icon name="chat" size={18} />
      <p>{item.name}</p>
    </div>
  );
}

export function Tile({ item, selecting, selected, onOpen, onLong }) {
  const press = useLongPress(onLong, onOpen);
  return (
    <button className={`tile ${selected ? 'selected' : ''}`} {...press}>
      <Thumb item={item} />
      {item.favorite && !selecting && <span className="fav-dot"><Icon name="heartFill" size={12} /></span>}
      {selecting && <span className={`sel-mark ${selected ? 'on' : ''}`}>{selected && <Icon name="check" size={14} />}</span>}
    </button>
  );
}

export function itemMeta(item) {
  const parts = [fmtDate(item.createdAt)];
  if (item.type === 'voice' || item.type === 'video') parts.push(fmtDur(item.duration));
  if (item.type === 'chat') parts.push(`${(item.messages || []).length} сообщ.`);
  if (item.size && item.type !== 'chat') parts.push(fmtSize(item.size));
  return parts.join(' • ');
}

const SWIPE_BTN = 78;

// Строка материала. swipe — быстрые действия, открывающиеся смахиванием влево.
export function ItemRow({ item, onOpen, onLong, selecting, selected, right, meta, swipe }) {
  const press = useLongPress(onLong, onOpen);
  const actions = !selecting && swipe ? swipe.filter(Boolean) : [];
  const sw = useRowSwipe({ width: actions.length * SWIPE_BTN, enabled: actions.length > 0 });
  return (
    <div className={`item-row ${selected ? 'selected' : ''} ${actions.length ? 'swipeable' : ''}`} {...sw.handlers}>
      {actions.length > 0 && (
        <div className="swipe-actions" style={{ width: actions.length * SWIPE_BTN }}>
          {actions.map((a) => (
            <button key={a.label} className={`swipe-btn ${a.tone || ''}`} onClick={a.run} aria-label={a.label}>
              <Icon name={a.icon} size={20} /><span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="item-slide" ref={sw.ref}>
        <button className="item-main" {...press}>
          <div className="row-thumb">
            {item.thumbId ? <Thumb item={item} /> : <div className="row-icon"><TypeIcon type={item.type} /></div>}
          </div>
          <div className="row-text">
            <b>{item.name}</b>
            <span>{meta || itemMeta(item)}</span>
          </div>
          {item.favorite && !selecting && <Icon name="heartFill" size={14} className="row-fav" />}
          {selecting && <span className={`sel-mark static ${selected ? 'on' : ''}`}>{selected && <Icon name="check" size={14} />}</span>}
        </button>
        {right}
      </div>
    </div>
  );
}

// Иллюстрация пустого экрана: стопка карточек с иконкой раздела.
export function EmptyArt({ icon }) {
  return (
    <div className="empty-art" aria-hidden="true">
      <span className="ea-glow" />
      <span className="ea-card back" />
      <span className="ea-card mid" />
      <span className="ea-card front"><Icon name={icon} size={34} /></span>
      <span className="ea-spark s1" />
      <span className="ea-spark s2" />
      <span className="ea-spark s3" />
    </div>
  );
}

export function Empty({ icon = 'folder', title, text, action }) {
  return (
    <div className="empty">
      <EmptyArt icon={icon} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

// Одноразовая подсказка; после закрытия больше не показывается.
export function Tip({ id, icon = 'info', children }) {
  const prefs = usePrefs();
  if (!prefs.onboarded || prefs.tipSeen(id)) return null;
  return (
    <div className="tip" role="note">
      <span className="tip-icon"><Icon name={icon} size={18} /></span>
      <span className="tip-text">{children}</span>
      <button className="tip-close" onClick={() => prefs.markTip(id)} aria-label="Понятно"><Icon name="close" size={16} /></button>
    </div>
  );
}

export function Toggle({ on }) {
  return <span className={`toggle ${on ? 'on' : ''}`}><i /></span>;
}
