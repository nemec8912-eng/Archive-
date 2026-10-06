import React from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar, ItemRow, Empty } from '../components/Common.jsx';
import { useStore, daysLeft, RECENT_DAYS } from '../store.jsx';
import { useNav, useUi } from '../ui.jsx';
import { groupByDay, fmtTime, filesWord } from '../lib/format.js';
import { haptic } from '../lib/haptics.js';

// «Недавно удалённые»: что удалено за последнюю неделю, по дням, с быстрым возвратом.
export default function Recent() {
  const store = useStore();
  const nav = useNav();
  const ui = useUi();
  const items = store.recentItems;
  const originName = (it) => store.folderById(it.originFolderId)?.name;

  const restore = (ids) => {
    haptic('success');
    store.restore(ids);
    ui.showToast(ids.length > 1 ? `Восстановлено: ${ids.length}` : 'Восстановлено');
  };

  return (
    <div className="screen with-nav">
      <TopBar
        title="Недавно удалённые"
        sub={items.length ? filesWord(items.length) : undefined}
        right={items.length > 1 && <button className="link-btn" onClick={() => restore(items.map((i) => i.id))}>Вернуть все</button>}
      />
      {!items.length ? (
        <Empty icon="restore" title="Ничего не удалялось" text={`Здесь появляется то, что удалено за последние ${RECENT_DAYS} дней. Всё удалённое раньше — в Корзине.`} />
      ) : (
        <>
          <p className="hint">Удалённое за последние {RECENT_DAYS} дней. Смахните строку влево или нажмите, чтобы вернуть на место.</p>
          {groupByDay(items, 'deletedAt').map((g) => (
            <section key={g.key} className="day-group">
              <h4 className="day-head">{g.label}</h4>
              <div className="list recent-list">
                {g.items.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    onOpen={() => restore([it.id])}
                    meta={`${fmtTime(it.deletedAt)}${originName(it) ? ` • из «${originName(it)}»` : ''} • в корзине ещё ${daysLeft(it.deletedAt)} дн.`}
                    swipe={[{ icon: 'restore', label: 'Вернуть', tone: 'accent', run: () => restore([it.id]) }]}
                    right={<button className="icon-btn" onClick={() => restore([it.id])} aria-label="Вернуть"><Icon name="restore" size={20} /></button>}
                  />
                ))}
              </div>
            </section>
          ))}
          <button className="text-btn center-btn" onClick={() => nav.push({ name: 'trash' })}>
            <Icon name="trash" size={18} />Вся корзина
          </button>
        </>
      )}
    </div>
  );
}
