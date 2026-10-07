import React, { useDeferredValue, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { ItemRow, Empty } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useNav } from '../ui.jsx';
import { useActions } from '../actions.js';
import { CATEGORIES } from '../lib/categories.js';
import { useProgressive } from '../lib/hooks.js';

const FILTERS = [{ type: 'all', title: 'Все' }, ...CATEGORIES];

// Текст для поиска считается один раз на материал (материалы в архиве не меняются на месте —
// при правке появляется новый объект, и текст пересчитывается).
const hayCache = new WeakMap();
function haystack(item) {
  let h = hayCache.get(item);
  if (h == null) { h = buildHaystack(item); hayCache.set(item, h); }
  return h;
}
function buildHaystack(item) {
  const parts = [item.name];
  if (item.text) parts.push(item.text);
  if (item.caption) parts.push(item.caption);
  (item.messages || []).forEach((m) => m.text && parts.push(m.text));
  return parts.join(' ').toLowerCase();
}

// Поиск по всему личному архиву (ТЗ, п. 13).
export default function Search() {
  const store = useStore();
  const nav = useNav();
  const act = useActions();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  // Пока печатают, список обновляется с небольшой задержкой — клавиатура не подтормаживает.
  const query = useDeferredValue(q);
  const results = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return store.visible
      .filter((i) => filter === 'all' || i.type === filter)
      .filter((i) => {
        if (!words.length) return true;
        const h = haystack(i);
        return words.every((w) => h.includes(w));
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [store.visible, query, filter]);
  const [shown, moreRef] = useProgressive(results.length, 80, `${query}|${filter}`);

  return (
    <div className="screen search-screen">
      <div className="search-top">
        <button className="icon-btn" onClick={nav.back} aria-label="Назад"><Icon name="back" size={24} /></button>
        <label className="search-field input">
          <Icon name="search" size={18} />
          <input autoFocus type="search" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
          {q && <button className="clear" onClick={() => setQ('')} aria-label="Очистить"><Icon name="close" size={16} /></button>}
        </label>
      </div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.type} className={`chip ${filter === f.type ? 'on' : ''}`} onClick={() => setFilter(f.type)}>{f.title}</button>
        ))}
      </div>
      {results.length ? (
        <div className="list">
          {results.slice(0, shown).map((it) => (
            <ItemRow key={it.id} item={it} onOpen={() => act.open(it, results)} onLong={() => act.peek(it, { list: results })} swipe={act.swipe(it)} />
          ))}
          {shown < results.length && <div ref={moreRef} className="list-more" aria-hidden="true" />}
        </div>
      ) : (
        <Empty icon="search" title="Ничего не найдено" text={q ? 'Попробуйте изменить запрос или фильтр.' : 'В этой категории пока нет материалов.'} />
      )}
    </div>
  );
}
