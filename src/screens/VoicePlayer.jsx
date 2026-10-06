import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useNav, Fixed } from '../ui.jsx';
import { useActions } from '../actions.js';
import { useBlobUrl } from '../lib/hooks.js';
import { fmtDur, fmtDate } from '../lib/format.js';

export function Waveform({ data = [], progress = 0, onSeek, className = '' }) {
  const ref = useRef();
  const seek = (e) => {
    if (!onSeek || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  return (
    <div ref={ref} className={`waveform ${className}`} onClick={seek}>
      {data.map((v, i) => (
        <i key={i} className={i / data.length < progress ? 'played' : ''} style={{ height: `${Math.round(v * 100)}%` }} />
      ))}
    </div>
  );
}

export function useAudio(url, knownDuration) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration || 0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    if (!url) return undefined;
    const a = new Audio(url);
    a.preload = 'metadata';
    audio.current = a;
    const upd = () => setTime(a.currentTime);
    const meta = () => { if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration); };
    a.addEventListener('timeupdate', upd);
    a.addEventListener('loadedmetadata', meta);
    a.addEventListener('durationchange', meta);
    a.addEventListener('play', () => setPlaying(true));
    a.addEventListener('pause', () => setPlaying(false));
    a.addEventListener('ended', () => { setPlaying(false); setTime(0); });
    return () => { a.pause(); audio.current = null; };
  }, [url]);

  return {
    playing,
    time,
    duration,
    rate,
    toggle() {
      const a = audio.current;
      if (!a) return;
      if (a.paused) a.play().catch(() => {}); else a.pause();
    },
    seek(t) {
      const a = audio.current;
      if (!a) return;
      a.currentTime = Math.min(Math.max(0, t), duration || a.duration || 0);
      setTime(a.currentTime);
    },
    cycleRate() {
      const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
      if (audio.current) audio.current.playbackRate = next;
      setRate(next);
    },
  };
}

// Проигрыватель голосовых записей (ТЗ, п. 9).
export default function VoicePlayer({ route }) {
  const store = useStore();
  const nav = useNav();
  const act = useActions();
  const item = store.byId[route.id];
  const url = useBlobUrl(item?.blobId);
  const p = useAudio(url, item?.duration);

  useEffect(() => {
    if (!item || item.deletedAt) nav.back();
  }, [item?.deletedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return <div className="screen" />;
  const progress = p.duration ? p.time / p.duration : 0;

  return (
    <div className="screen player-screen">
      <TopBar title="" right={<button className="icon-btn" onClick={() => act.menu(item, { inViewer: true })} aria-label="Ещё"><Icon name="more" size={22} /></button>} />
      <div className="player">
        <h2 className="player-title">{item.name}</h2>
        <p className="muted">{fmtDate(item.createdAt)} • {fmtDur(p.duration)}</p>
        <Waveform className="big" data={item.waveform} progress={progress} onSeek={(f) => p.seek(f * p.duration)} />
        <input
          className="range"
          type="range"
          min="0"
          max={p.duration || 0}
          step="0.1"
          value={p.time}
          onChange={(e) => p.seek(parseFloat(e.target.value))}
          style={{ '--pct': `${progress * 100}%` }}
          aria-label="Позиция"
        />
        <div className="times"><span>{fmtDur(p.time)}</span><span>{fmtDur(p.duration)}</span></div>
        <div className="controls">
          <button className="rate" onClick={p.cycleRate}>{String(p.rate).replace('.', ',')}x</button>
          <button className="icon-btn big" onClick={() => p.seek(p.time - 10)} aria-label="Назад на 10 секунд"><Icon name="rew" size={32} /></button>
          <button className="play-btn" onClick={p.toggle} disabled={!url} aria-label={p.playing ? 'Пауза' : 'Воспроизвести'}>
            <Icon name={p.playing ? 'pause' : 'play'} size={34} />
          </button>
          <button className="icon-btn big" onClick={() => p.seek(p.time + 10)} aria-label="Вперёд на 10 секунд"><Icon name="fwd" size={32} /></button>
          <span className="rate ghost" />
        </div>
      </div>
      <Fixed>
      <div className="action-bar fixed">
        <button className={item.favorite ? 'on' : ''} onClick={() => act.toggleFav([item.id], !item.favorite)}>
          <Icon name={item.favorite ? 'heartFill' : 'heart'} size={22} /><span>{item.favorite ? 'В избранном' : 'В избранное'}</span>
        </button>
        <button onClick={() => act.remove([item.id])}><Icon name="trash" size={22} /><span>Удалить</span></button>
        <button onClick={() => act.menu(item, { inViewer: true })}><Icon name="more" size={22} /><span>Ещё</span></button>
      </div>
      </Fixed>
    </div>
  );
}
