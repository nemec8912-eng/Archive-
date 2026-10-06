import React from 'react';
import Icon from '../components/Icon.jsx';
import { useStore } from '../store.jsx';
import { useNav, useUi } from '../ui.jsx';
import { CATEGORIES } from '../lib/categories.js';

// Главный экран (ТЗ, п. 4). Раздела «Недавние файлы» здесь нет намеренно.
export default function Home() {
  const store = useStore();
  const nav = useNav();
  const ui = useUi();
  const counts = {};
  store.visible.forEach((i) => { counts[i.type] = (counts[i.type] || 0) + 1; });

  return (
    <div className="screen with-nav">
      <div className="home-head">
        <button className="icon-btn" onClick={() => nav.goTab('settings')} aria-label="Настройки"><Icon name="gear" size={24} /></button>
        <button className="round-add" onClick={() => ui.open({ type: 'add' })} aria-label="Добавить"><Icon name="plus" size={24} /></button>
      </div>
      <h1 className="big-title">Архив</h1>
      <button className="search-field" onClick={() => nav.push({ name: 'search' })}>
        <Icon name="search" size={18} />
        <span>Поиск в архиве…</span>
      </button>
      <div className="cat-grid">
        {CATEGORIES.map((c) => (
          <button key={c.type} className="cat-card" onClick={() => nav.push({ name: 'collection', kind: 'category', type: c.type })}>
            <span className={`cat-icon c-${c.type}`}><Icon name={c.icon} size={22} /></span>
            <span className="cat-text">
              <b>{c.title}</b>
              <small>{counts[c.type] || 0}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
