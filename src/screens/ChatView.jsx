import React, { useEffect, useState } from 'react';

const PAGE = 400; // длинные переписки показываются частями
import Icon from '../components/Icon.jsx';
import { TopBar } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useNav, Fixed } from '../ui.jsx';
import { useActions } from '../actions.js';
import { useBlobUrl } from '../lib/hooks.js';
import { fmtDate, fmtTime, fmtDur, dayKey, dayLabel } from '../lib/format.js';
import { useAudio, Waveform } from './VoicePlayer.jsx';

export function VoiceBubble({ blobId, duration, waveform }) {
  const url = useBlobUrl(blobId);
  const p = useAudio(url, duration);
  const progress = p.duration ? p.time / p.duration : 0;
  return (
    <div className="voice-bubble">
      <button className="mini-play" onClick={p.toggle} disabled={!url} aria-label={p.playing ? 'Пауза' : 'Воспроизвести'}>
        <Icon name={p.playing ? 'pause' : 'play'} size={18} />
      </button>
      <Waveform className="inline" data={waveform || []} progress={progress} onSeek={(f) => p.seek(f * p.duration)} />
      <span className="vb-time">{fmtDur(p.playing || p.time ? p.time : p.duration)}</span>
    </div>
  );
}

function MediaBubble({ m }) {
  const url = useBlobUrl(m.blobId);
  if (!url) return <div className="bubble-media ph" />;
  if (m.kind === 'video') return <video className="bubble-media" src={url} controls playsInline preload="metadata" />;
  return <img className="bubble-media" src={url} alt="" />;
}

// Сохранённая переписка: только чтение, не мессенджер (ТЗ, п. 10).
export default function ChatView({ route }) {
  const store = useStore();
  const nav = useNav();
  const act = useActions();
  const item = store.byId[route.id];
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!item || item.deletedAt) nav.back();
  }, [item?.deletedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return <div className="screen" />;

  return (
    <div className="screen chat-screen">
      <TopBar title={item.name} sub={fmtDate(item.chatStart || item.createdAt)} />
      <div className="chat">
        {(item.messages || []).length > shown && (
          <button className="btn ghost chat-more" onClick={() => setShown((n) => n + PAGE)}>
            Показать более ранние ({(item.messages || []).length - shown})
          </button>
        )}
        {(item.messages || []).slice(-shown).map((m, i, all) => (
          <React.Fragment key={m.id}>
          {m.time && (i === 0 || !all[i - 1].time || dayKey(all[i - 1].time) !== dayKey(m.time)) && (
            <div className="chat-day">{dayLabel(m.time)}</div>
          )}
          <div className={`bubble ${m.from === 'me' ? 'me' : 'them'} ${m.kind !== 'text' ? 'media' : ''}`}>
            {m.kind === 'text' && <p>{m.text}</p>}
            {(m.kind === 'photo' || m.kind === 'video') && <MediaBubble m={m} />}
            {m.kind === 'voice' && <VoiceBubble blobId={m.blobId} duration={m.duration} waveform={m.waveform} />}
            {m.time && <time>{fmtTime(m.time)}</time>}
          </div>
          </React.Fragment>
        ))}
        {!(item.messages || []).length && <p className="hint">Переписка пустая</p>}
      </div>
      <Fixed>
      <div className="action-bar fixed">
        <button onClick={() => act.share(item)}><Icon name="share" size={22} /><span>Поделиться</span></button>
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
