import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Thumb } from './Common.jsx';
import { useBlobUrl } from '../lib/hooks.js';
import { fmtDate, fmtDur, fmtTime, fmtSize } from '../lib/format.js';
import { Waveform, useAudio } from '../screens/VoicePlayer.jsx';

function VisualPeek({ item }) {
  const url = useBlobUrl(item.blobId);
  const [ready, setReady] = useState(false);
  return (
    <div className="peek-visual" style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}>
      {!ready && <Thumb item={item} className="peek-under" />}
      {url && item.type === 'video' && (
        <video src={url} muted autoPlay loop playsInline onLoadedData={() => setReady(true)} />
      )}
      {url && item.type !== 'video' && <img src={url} alt="" draggable="false" onLoad={() => setReady(true)} />}
    </div>
  );
}

function VoicePeek({ item }) {
  const url = useBlobUrl(item.blobId);
  const p = useAudio(url, item.duration);
  return (
    <div className="peek-voice">
      <button className="play-btn small" onClick={p.toggle} disabled={!url} aria-label={p.playing ? 'Пауза' : 'Воспроизвести'}>
        <Icon name={p.playing ? 'pause' : 'play'} size={26} />
      </button>
      <Waveform data={item.waveform || []} progress={p.duration ? p.time / p.duration : 0} onSeek={(f) => p.seek(f * p.duration)} className="inline accent" />
      <span className="vb-time">{fmtDur(p.playing || p.time ? p.time : p.duration)}</span>
    </div>
  );
}

function TextPeek({ item }) {
  if (item.type === 'chat') {
    const msgs = (item.messages || []).slice(0, 8);
    return (
      <div className="peek-chat">
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.from === 'me' ? 'me' : 'them'}`}>
            <p>{m.kind === 'text' ? m.text : { photo: 'Фото', video: 'Видео', voice: 'Голосовое' }[m.kind] || 'Вложение'}</p>
            {m.time && <time>{fmtTime(m.time)}</time>}
          </div>
        ))}
        {!msgs.length && <p className="muted">Переписка пустая</p>}
      </div>
    );
  }
  return <div className="peek-note">{item.text || 'Пустая заметка'}</div>;
}

// Быстрый просмотр по долгому нажатию: крупное превью и действия под ним.
export default function Peek({ item, actions, onOpen, onPick, onClose }) {
  const layer = useRef();
  // Палец, которым удерживали материал, ещё на экране: его отпускание не должно закрывать просмотр.
  const armed = useRef(false);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const visual = item.type === 'photo' || item.type === 'video' || item.type === 'screenshot';
  return (
    <div
      className="peek-layer"
      ref={layer}
      onPointerDown={() => { armed.current = true; }}
      onClickCapture={(e) => { if (!armed.current) { e.stopPropagation(); e.preventDefault(); } }}
      onClick={onClose}
    >
      <div className="peek" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={item.name}>
        <button className="peek-preview" onClick={onOpen} aria-label="Открыть">
          {visual ? <VisualPeek item={item} /> : item.type === 'voice' ? null : <TextPeek item={item} />}
        </button>
        {item.type === 'voice' && <VoicePeek item={item} />}
        <div className="peek-info">
          <b>{item.name}</b>
          <span>{[fmtDate(item.createdAt), item.size ? fmtSize(item.size) : null].filter(Boolean).join(' • ')}</span>
          {item.caption && <p className="peek-caption">{item.caption}</p>}
        </div>
        <div className="menu-list peek-menu">
          {actions.map((a) => (
            <button key={a.label} className={`menu-item ${a.danger ? 'danger' : ''}`} onClick={() => onPick(a)}>
              <span className="mi-label">{a.label}</span>
              <span className="mi-icon"><Icon name={a.icon} size={20} /></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
