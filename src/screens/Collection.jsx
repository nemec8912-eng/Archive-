import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar, Tile, ItemRow, Empty, Tip, Thumb } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useUi, Fixed } from '../ui.jsx';
import { haptic } from '../lib/haptics.js';
import { useActions } from '../actions.js';
import { CATEGORIES, CATEGORY, VISUAL } from '../lib/categories.js';
import { filesWord, groupByDay } from '../lib/format.js';
import { usePrefs } from '../prefs.jsx';
import { useProgressive } from '../lib/hooks.js';

const COLS = [2, 3, 4, 5];
const TYPE_ORDER = Object.fromEntries(CATEGORIES.map((c, i) => [c.type, i]));
export const SORTS = [
  { id: 'new', label: 'Сначала новые', fn: (a, b) => b.createdAt - a.createdAt },
  { id: 'old', label: 'Сначала старые', fn: (a, b) => a.createdAt - b.createdAt },
  { id: 'name', label: 'По названию', fn: (a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }) },
  { id: 'size', label: 'По размеру', fn: (a, b) => (b.size || 0) - (a.size || 0) },
  { id: 'type', label: 'По типу', fn: (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || b.createdAt - a.createdAt },
];

// Перетаскивание материалов в другую папку: миниатюра под пальцем и панель папок снизу.
function useDragToFolder({ currentFolderId, onDrop }) {
  const [drag, setDrag] = useState(null); // { ids, item }
  const [over, setOver] = useState(null);
  const ghost = useRef();
  const overRef = useRef(null);

  useEffect(() => {
    if (!drag) return undefined;
    const stop = (e) => e.preventDefault();
    document.addEventListener('touchmove', stop, { passive: false });
    document.body.classList.add('dragging');
    return () => {
      document.removeEventListener('touchmove', stop);
      document.body.classList.remove('dragging');
    };
  }, [drag]);

  const place = (x, y) => {
    if (ghost.current) ghost.current.style.transform = `translate3d(${x - 36}px, ${y - 36}px, 0)`;
    const el = document.elementFromPoint(x, y)?.closest('[data-drop]');
    const id = el ? el.dataset.drop : null;
    if (id !== overRef.current) {
      overRef.current = id;
      setOver(id);
      if (id) haptic('selection');
    }
  };

  const bind = (item, ids) => ({
    onStart: (x, y) => {
      setDrag({ item, ids });
      requestAnimationFrame(() => place(x, y));
    },
    onMove: place,
    onEnd: (x) => {
      const target = x == null ? null : overRef.current;
      overRef.current = null;
      setOver(null);
      setDrag(null);
      if (target) onDrop(ids, target === 'none' ? null : target);
    },
  });

  const view = drag && (
    <Fixed>
      <div className="drag-ghost" ref={ghost}>
        <Thumb item={drag.item} />
        {drag.ids.length > 1 && <span className="drag-count">{drag.ids.length}</span>}
      </div>
      <DropDock currentFolderId={currentFolderId} over={over} />
    </Fixed>
  );
  return { bind, view, active: !!drag };
}

function DropDock({ currentFolderId, over }) {
  const store = useStore();
  const folders = store.folders.filter((f) => !f.hidden && f.id !== currentFolderId);
  return (
    <div className="drop-dock">
      <p>Отпустите над папкой, чтобы переместить</p>
      <div className="drop-list">
        {folders.map((f) => (
          <div key={f.id} data-drop={f.id} className={`drop-target ${over === f.id ? 'over' : ''}`}>
            <Icon name="folderFill" size={22} /><span>{f.name}</span>
          </div>
        ))}
        {currentFolderId && (
          <div data-drop="none" className={`drop-target ${over === 'none' ? 'over' : ''}`}>
            <Icon name="close" size={20} /><span>Без папки</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Категория, папка или «Избранное»: сетка миниатюр / список, выбор нескольких.
export default function Collection({ route }) {
  const store = useStore();
  const ui = useUi();
  const act = useActions();
  const prefs = usePrefs();
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const pinch = useRef(null);

  const isFav = route.name === 'favorites';
  const folder = route.kind === 'folder' ? store.folderById(route.folderId) : null;
  const sortKey = isFav ? 'fav' : route.kind === 'category' ? `cat:${route.type}` : `folder:${route.folderId}`;
  const sortId = prefs.sortFor(sortKey);
  const sort = SORTS.find((x) => x.id === sortId) || SORTS[0];
  const cols = COLS.includes(prefs.gridCols) ? prefs.gridCols : 3;
  const setCols = (n) => { if (n !== cols && COLS.includes(n)) { haptic('selection'); prefs.set({ gridCols: n }); } };

  const items = useMemo(() => {
    let list;
    if (isFav) list = store.visible.filter((i) => i.favorite);
    else if (route.kind === 'category') list = store.visible.filter((i) => i.type === route.type);
    else list = store.items.filter((i) => !i.deletedAt && i.folderId === route.folderId);
    return [...list].sort(sort.fn);
  }, [store.visible, store.items, isFav, route.kind, route.type, route.folderId, sort]);

  const title = isFav ? 'Избранное' : route.kind === 'category' ? CATEGORY[route.type].title : folder?.name || 'Папка';
  const asGrid = isFav || route.kind === 'folder' || VISUAL.has(route.type);
  const byDate = sort.id === 'new' || sort.id === 'old';

  const toggle = (id) => {
    haptic('selection');
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const endSelect = () => { setSelecting(false); setSel(new Set()); };
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const ids = [...sel].filter((id) => itemIds.has(id));
  // Большие папки рисуются частями по мере прокрутки.
  const [shown, moreRef] = useProgressive(items.length, 120, `${sortKey}:${sort.id}`);
  const visibleItems = shown < items.length ? items.slice(0, shown) : items;
  const allSelected = items.length > 0 && ids.length === items.length;
  const selectAll = () => { haptic('selection'); setSel(allSelected ? new Set() : new Set(items.map((i) => i.id))); };
  const allFav = ids.length > 0 && ids.every((id) => store.byId[id]?.favorite);
  const canSave = ids.some((id) => store.byId[id]?.blobId);

  const dnd = useDragToFolder({
    currentFolderId: folder?.id || null,
    onDrop: (moveIds, folderId) => {
      store.move(moveIds, folderId);
      haptic('success');
      const name = folderId ? store.folderById(folderId)?.name : 'Без папки';
      ui.showToast(`Перемещено в «${name}»${moveIds.length > 1 ? `: ${moveIds.length}` : ''}`);
      if (selecting) endSelect();
    },
  });

  const onOpen = (item) => (selecting ? toggle(item.id) : act.open(item, items));
  const onLong = (item) => {
    if (selecting) toggle(item.id);
    else act.peek(item, { list: items });
  };
  const dragFor = (item) => {
    const b = dnd.bind(item, selecting && sel.has(item.id) && ids.length ? ids : [item.id]);
    return { ...b, onStart: (x, y) => { ui.close(); b.onStart(x, y); } };
  };

  const sortMenu = () =>
    ui.open({
      type: 'menu',
      title: 'Сортировка',
      actions: SORTS.map((x) => ({ icon: x.id === sort.id ? 'check' : 'sort', label: x.label, run: () => { haptic('selection'); prefs.setSort(sortKey, x.id); } })),
    });

  const emptyText = isFav
    ? 'Отметьте важные материалы сердечком — они появятся здесь.'
    : 'Нажмите «+», чтобы добавить материал.';

  const tile = (it) => (
    <Tile key={it.id} item={it} selecting={selecting} selected={sel.has(it.id)} onOpen={() => onOpen(it)} onLong={() => onLong(it)} drag={dragFor(it)} />
  );

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
      ) : (
        <>
          <Tip id="longpress" icon="hand">
            {asGrid
              ? 'Удерживайте материал — быстрый просмотр и действия; удерживайте и ведите — перенос в другую папку.'
              : 'Удерживайте материал — быстрый просмотр и действия. Смахните строку влево — быстрые действия.'}
          </Tip>
          <div className="view-bar">
            <button className="vb-sort" onClick={sortMenu}>
              <Icon name="sort" size={16} />{sort.label}
            </button>
            {asGrid && (
              <button
                className="icon-btn small"
                onClick={() => setCols(COLS[(COLS.indexOf(cols) + 1) % COLS.length])}
                aria-label={`Размер миниатюр: ${cols} в ряд`}
              >
                <Icon name={cols >= 4 ? 'gridSmall' : 'grid'} size={20} />
                <span className="vb-cols">{cols}</span>
              </button>
            )}
          </div>
          {asGrid ? (
            <div
              className="groups"
              onTouchStart={(e) => {
                if (e.touches.length === 2) {
                  const [a, b] = e.touches;
                  pinch.current = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), done: false };
                }
              }}
              onTouchMove={(e) => {
                const p = pinch.current;
                if (!p || p.done || e.touches.length !== 2) return;
                const [a, b] = e.touches;
                const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                if (d - p.d > 60) { setCols(cols - 1); p.done = true; }
                if (p.d - d > 60) { setCols(cols + 1); p.done = true; }
              }}
              onTouchEnd={() => { pinch.current = null; }}
            >
              {byDate ? groupByDay(visibleItems).map((grp) => (
                <section key={grp.key} className="day-group">
                  <h4 className="day-head">{grp.label}</h4>
                  <div className="grid" style={{ '--cols': cols }}>{grp.items.map(tile)}</div>
                </section>
              )) : (
                <div className="grid" style={{ '--cols': cols }}>{visibleItems.map(tile)}</div>
              )}
              {shown < items.length && <div ref={moreRef} className="list-more" aria-hidden="true" />}
            </div>
          ) : (
            <div className="list">
              {visibleItems.map((it) => (
                <ItemRow key={it.id} item={it} selecting={selecting} selected={sel.has(it.id)} onOpen={() => onOpen(it)} onLong={() => onLong(it)} swipe={act.swipe(it)} />
              ))}
              {shown < items.length && <div ref={moreRef} className="list-more" aria-hidden="true" />}
            </div>
          )}
        </>
      )}

      {dnd.view}

      {selecting && (
        <Fixed>
          <div className="sel-bar">
            <div className="sel-actions four">
              <button disabled={!ids.length} onClick={() => { act.toggleFav(ids, !allFav); endSelect(); }}>
                <Icon name={allFav ? 'heartFill' : 'heart'} size={22} /><span>{allFav ? 'Убрать' : 'В избранное'}</span>
              </button>
              <button disabled={!ids.length} onClick={() => { act.move(ids); endSelect(); }}>
                <Icon name="folderMove" size={22} /><span>Переместить</span>
              </button>
              <button disabled={!canSave} onClick={() => { act.saveGallery(ids); endSelect(); }}>
                <Icon name="gallery" size={22} /><span>В галерею</span>
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
