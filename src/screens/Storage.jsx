import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar, ItemRow } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useNav } from '../ui.jsx';
import { useActions } from '../actions.js';
import { CATEGORIES } from '../lib/categories.js';
import { fmtSize, filesWord } from '../lib/format.js';

// Оттенки акцента для долей категорий на полосе.
const SHADES = ['var(--accent)', 'var(--accent-2)', 'var(--accent-text)', '#8a8fa0', '#5d6273', '#3a4054'];

export function useQuota() {
  const [q, setQ] = useState(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setQ({ quota: e.quota || 0, usage: e.usage || 0 })).catch(() => {});
  }, []);
  return q;
}

// Экран занятого места: по категориям, папкам, корзина и самые большие файлы.
export default function StorageScreen() {
  const store = useStore();
  const nav = useNav();
  const act = useActions();
  const q = useQuota();

  const live = store.items.filter((i) => !i.deletedAt);
  const trash = store.items.filter((i) => i.deletedAt);
  const sum = (l) => l.reduce((s, i) => s + (i.size || 0), 0);
  const used = sum(live);
  const trashSize = sum(trash);
  const cats = CATEGORIES.map((c, k) => {
    const l = live.filter((i) => i.type === c.type);
    return { ...c, size: sum(l), count: l.length, color: SHADES[k] };
  });
  const total = used + trashSize || 1;
  const folders = store.folders
    .map((f) => {
      const l = live.filter((i) => i.folderId === f.id);
      return { f, size: sum(l), count: l.length };
    })
    .filter((x) => x.count)
    .sort((a, b) => b.size - a.size);
  const biggest = [...live].filter((i) => i.size).sort((a, b) => b.size - a.size).slice(0, 10);
  const free = q?.quota ? Math.max(0, q.quota - q.usage) : null;

  return (
    <div className="screen">
      <TopBar title="Занятое место" />
      <div className="set-card storage-card">
        <div className="storage-total">
          <b>{fmtSize(used + trashSize)}</b>
          <span>{free != null ? `свободно для архива ≈ ${fmtSize(free)}` : 'занято архивом'}</span>
        </div>
        <div className="storage-stack" role="img" aria-label="Распределение по категориям">
          {cats.filter((c) => c.size).map((c) => <i key={c.type} style={{ width: `${(c.size / total) * 100}%`, background: c.color }} />)}
          {trashSize > 0 && <i style={{ width: `${(trashSize / total) * 100}%`, background: 'var(--danger)' }} />}
        </div>
        <div className="storage-legend">
          {cats.map((c) => (
            <button key={c.type} className="sl-row" onClick={() => nav.push({ name: 'collection', kind: 'category', type: c.type })}>
              <span className="sl-dot" style={{ background: c.color }} />
              <span className="sl-name">{c.title}</span>
              <span className="sl-count">{c.count}</span>
              <span className="sl-size">{fmtSize(c.size)}</span>
            </button>
          ))}
          <button className="sl-row" onClick={() => nav.push({ name: 'trash' })}>
            <span className="sl-dot" style={{ background: 'var(--danger)' }} />
            <span className="sl-name">Корзина</span>
            <span className="sl-count">{trash.length}</span>
            <span className="sl-size">{fmtSize(trashSize)}</span>
          </button>
        </div>
      </div>

      <div className="set-card storage-actions">
        <button className="set-row" onClick={() => nav.push({ name: 'duplicates' })}>
          <span className="set-icon"><Icon name="duplicate" size={20} /></span>
          <span className="set-label">Поиск дубликатов</span>
          <Icon name="chevron" size={18} className="muted" />
        </button>
      </div>

      {folders.length > 0 && (
        <>
          <h4 className="set-group">Папки</h4>
          <div className="set-card">
            {folders.map(({ f, size, count }) => (
              <button key={f.id} className="set-row" onClick={() => nav.push({ name: 'collection', kind: 'folder', folderId: f.id })}>
                <span className="set-icon"><Icon name="folderFill" size={20} /></span>
                <span className="set-label">{f.name}{f.hidden ? ' (скрыта)' : ''}</span>
                <span className="set-value">{filesWord(count)} • {fmtSize(size)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {biggest.length > 0 && (
        <>
          <h4 className="set-group">Самые большие файлы</h4>
          <div className="list">
            {biggest.map((it) => (
              <ItemRow key={it.id} item={it} onOpen={() => act.open(it, biggest)} onLong={() => act.peek(it, { list: biggest })} meta={`${fmtSize(it.size)} • ${store.folderById(it.folderId)?.name || 'Без папки'}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
