import { useStore } from './store.jsx';
import { useNav, useUi } from './ui.jsx';
import { VISUAL } from './lib/categories.js';
import { shareItem } from './lib/media.js';
import { haptic } from './lib/haptics.js';

// Общая логика действий с материалами (ТЗ, п. 15).
export function useActions() {
  const store = useStore();
  const nav = useNav();
  const ui = useUi();

  const open = (item, list = []) => {
    if (VISUAL.has(item.type)) {
      const ids = list.filter((i) => VISUAL.has(i.type)).map((i) => i.id);
      const pool = ids.includes(item.id) ? ids : [item.id];
      nav.push({ name: 'viewer', ids: pool, index: pool.indexOf(item.id) });
    } else if (item.type === 'voice') {
      const ids = list.filter((i) => i.type === 'voice').map((i) => i.id);
      nav.push({ name: 'voice', id: item.id, ids: ids.includes(item.id) ? ids : [item.id] });
    } else if (item.type === 'chat') {
      nav.push({ name: 'chat', id: item.id });
    } else {
      nav.push({ name: 'note', id: item.id });
    }
  };

  const remove = (ids, after) => {
    haptic('medium');
    store.trash(ids);
    ui.showToast(ids.length > 1 ? `Перемещено в корзину: ${ids.length}` : 'Перемещено в корзину', {
      label: 'Отменить',
      run: () => { haptic('light'); store.restore(ids); },
    });
    after?.();
  };

  const rename = (item) =>
    ui.prompt({
      title: 'Переименовать',
      value: item.name,
      okText: 'Сохранить',
      onOk: (name) => name.trim() && store.rename(item.id, name.trim()),
    });

  const move = (ids) =>
    ui.pickFolder({
      title: 'Переместить в…',
      onPick: (folderId) => {
        haptic('light');
        store.move(ids, folderId);
        ui.showToast('Перемещено');
      },
    });

  const copy = (ids) =>
    ui.pickFolder({
      title: 'Копировать в…',
      onPick: async (folderId) => {
        await store.copy(ids, folderId);
        ui.showToast('Копия создана');
      },
    });

  const toggleFav = (ids, value) => {
    haptic(value ? 'success' : 'light');
    store.setFavorite(ids, value);
    ui.showToast(value ? 'Добавлено в избранное' : 'Убрано из избранного');
  };

  const share = (item) =>
    shareItem(item).catch(() => ui.showToast('Не удалось поделиться'));

  const menu = (item, { list, inViewer = false, onDeleted } = {}) =>
    ui.open({
      type: 'actions',
      item,
      actions: [
        !inViewer && { icon: 'open', label: 'Открыть', run: () => open(item, list) },
        { icon: 'pencil', label: 'Переименовать', run: () => rename(item) },
        { icon: 'folderMove', label: 'Переместить', run: () => move([item.id]) },
        { icon: 'copy', label: 'Копировать', run: () => copy([item.id]) },
        {
          icon: item.favorite ? 'heartFill' : 'heart',
          label: item.favorite ? 'Убрать из избранного' : 'В избранное',
          run: () => toggleFav([item.id], !item.favorite),
        },
        { icon: 'share', label: 'Поделиться', run: () => share(item) },
        { icon: 'trash', label: 'Удалить', danger: true, run: () => remove([item.id], onDeleted) },
      ].filter(Boolean),
    });

  return { open, menu, remove, rename, move, copy, toggleFav, share };
}
