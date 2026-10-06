import React, { useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar, Tile, ItemRow, Empty, Tip } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useUi, Fixed } from '../ui.jsx';
import { haptic } from '../lib/haptics.js';
import { useActions } from '../actions.js';
import { CATEGORY, VISUAL } from '../lib/categories.js';
import { filesWord } from '../lib/format.js';

// Категория, папка или «Избранное»: сетка миниатюр / список, выбор нескольких.
export default function Collection({ route }) {
  const store = useStore();
  const ui = useUi();
  const act = useActions();
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(() => new Set());

  const isFav = route.name === 'favorites';
  const folder = route.kind === 'folder' ? store.folderById(route.folderId) : null;

  const items = useMemo(() => {
    let list;
    if (isFav) list = store.visible.filter((i) => i.favorite);
    else if (route.kind === 'category') list = store.visible.filter((i) => i.type === route.type);
    else list = store.items.filter((i) => !i.deletedAt && i.folderId === route.folderId);
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [store.visible, store.items, isFav, route.kind, route.type, route.folderId]);

  const title = isFav ? 'Избранное' : route.kind === 'category' ? CATEGORY[route.type].title : folder?.name || 'Папка';
  const asGrid = isFav || route.kind === 'folder' || VISUAL.has(route.type);

  const toggle = (id) => {
    haptic('selection');
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const endSelect = () => { setSelecting(false); setSel(new Set()); };
  const ids = [...sel].filter((id) => items.some((i) => i.id === id));
  const allSelected = items.length > 0 && ids.length === items.length;
  const selectAll = () => { haptic('selection'); setSel(allSelected ? new Set() : new Set(items.map((i) => i.id))); };
  const allFav = ids.length > 0 && ids.every((id) => store.byId[id]?.favorite);

  const onOpen = (item) => (selecting ? toggle(item.id) : act.open(item, items));
  const onLong = (item) => {
    if (selecting) toggle(item.id);
    else act.menu(item, { list: items });
  };

  const emptyText = isFav
    ? 'Отметьте важные материалы сердечком — они появятся здесь.'
    : 'Нажмите «+», чтобы добавить материал.';

  return (
    <div className={`screen ${selecting ? 'with-selbar' : 'with-nav'}`}>
      <TopBar
        title={selecting ? (ids.length ? `Выбрано: ${ids.length}` : 'Выберите') : title}
        sub={selecting ? `из ${items.length}` : folder || isFav ? filesWord(items.length) : undefined}
        back={!isFav}
        left={selecting ? <button className="link-btn" onClick={selectAll}>{allSelected ? 'Снять' : 'Все'}</button> : undefined}
        right={
          items.length > 0 && (
            <button className="link-btn" onClick={() => (selecting ? endSelect() : setSelecting(true))}>
              {selecting ? 'Готово' : 'Выбрать'}
            </button>
          )
        }
      />
      {!items.length ? (
        <Empty
          icon={isFav ? 'heart' : route.kind === 'category' ? CATEGORY[route.type].icon : 'folder'}
          title={isFav ? 'В избранном пусто' : 'Здесь пока пусто'}
          text={emptyText}
          action={!isFav && <button className="btn primary" onClick={() => ui.open({ type: 'add' })}><Icon name="plus" size={18} />Добавить</button>}
        />
      ) : asGrid ? (
        <>
        <Tip id="longpress" icon="hand">Удерживайте материал, чтобы открыть действия. «Выбрать» — несколько сразу.</Tip>
        <div className="grid">
          {items.map((it) => (
            <Tile key={it.id} item={it} selecting={selecting} selected={sel.has(it.id)} onOpen={() => onOpen(it)} onLong={() => onLong(it)} />
          ))}
        </div>
        </>
      ) : (
        <div className="list">
          {items.map((it) => (
            <ItemRow key={it.id} item={it} selecting={selecting} selected={sel.has(it.id)} onOpen={() => onOpen(it)} onLong={() => onLong(it)} />
          ))}
        </div>
      )}

      {selecting && (
        <Fixed>
        <div className="sel-bar">
          <div className="sel-actions">
            <button disabled={!ids.length} onClick={() => { act.toggleFav(ids, !allFav); endSelect(); }}>
              <Icon name={allFav ? 'heartFill' : 'heart'} size={22} /><span>{allFav ? 'Убрать' : 'В избранное'}</span>
            </button>
            <button disabled={!ids.length} onClick={() => { act.move(ids); endSelect(); }}>
              <Icon name="folderMove" size={22} /><span>Переместить</span>
            </button>
            <button disabled={!ids.length} className="danger" onClick={() => { act.remove(ids); endSelect(); }}>
              <Icon name="trash" size={22} /><span>Удалить</span>
            </button>
          </div>
        </div>
        </Fixed>
      )}
    </div>
  );
}
