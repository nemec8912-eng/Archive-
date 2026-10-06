import React from 'react';
import Icon from './Icon.jsx';
import { useNav, useUi } from '../ui.jsx';
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
      <button className="nav-add" onClick={() => ui.open({ type: 'add' })} aria-label="Добавить">
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

export function Thumb({ item, className = '' }) {
  const [ref, seen] = useInView();
  const url = useBlobUrl(item.thumbId, { cache: true, enabled: seen });
  if (item.type === 'photo' || item.type === 'screenshot' || item.type === 'video') {
    return (
      <div ref={ref} className={`thumb ${className}`}>
        {url ? <img src={url} alt="" draggable="false" /> : <div className="thumb-ph"><TypeIcon type={item.type} size={26} /></div>}
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

export function ItemRow({ item, onOpen, onLong, selecting, selected, right, meta }) {
  const press = useLongPress(onLong, onOpen);
  return (
    <div className={`item-row ${selected ? 'selected' : ''}`}>
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
  );
}

export function Empty({ icon = 'folder', title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={30} /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Toggle({ on }) {
  return <span className={`toggle ${on ? 'on' : ''}`}><i /></span>;
}
