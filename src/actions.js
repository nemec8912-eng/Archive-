import { useStore } from './store.jsx';
import { useNav, useUi } from './ui.jsx';
import { VISUAL } from './lib/categories.js';
import { shareItem, saveToGallery } from './lib/media.js';
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

  const caption = (item) =>
    ui.prompt({
      title: 'Подпись',
      value: item.caption || '',
      placeholder: 'Например: где и когда снято',
      okText: 'Сохранить',
      multiline: true,
      allowEmpty: true,
      maxLength: 500,
      onOk: (text) => {
        store.updateItem(item.id, { caption: text.trim() || undefined });
        ui.showToast(text.trim() ? 'Подпись сохранена' : 'Подпись удалена');
      },
    });

  const edit = (item) => nav.push({ name: 'editor', id: item.id });

  const saveGallery = async (ids) => {
    const list = ids.map((id) => store.byId[id]).filter((i) => i && i.blobId);
    if (!list.length) { ui.showToast('Нечего сохранять: выберите фото, видео или голосовые'); return; }
    ui.showToast('Подготовка…', null, 0);
    try {
      const n = await saveToGallery(list);
      if (n) { haptic('success'); ui.showToast(`Готово: ${n}`); } else ui.hideToast();
    } catch (e) {
      ui.showToast(e?.code === 'permission' ? e.message : 'Не удалось сохранить');
    }
  };

  const toggleFav = (ids, value) => {
    haptic(value ? 'success' : 'light');
    store.setFavorite(ids, value);
    ui.showToast(value ? 'Добавлено в избранное' : 'Убрано из избранного');
  };

  const share = (item) =>
    shareItem(item).catch(() => ui.showToast('Не удалось поделиться'));

  const itemActions = (item, { list, inViewer = false, onDeleted } = {}) => [
    !inViewer && { icon: 'open', label: 'Открыть', run: () => open(item, list) },
    VISUAL.has(item.type) && { icon: 'crop', label: item.type === 'video' ? 'Обрезать' : 'Редактировать', run: () => edit(item) },
    { icon: 'pencil', label: 'Переименовать', run: () => rename(item) },
    { icon: 'caption', label: item.caption ? 'Изменить подпись' : 'Подпись', run: () => caption(item) },
    { icon: 'folderMove', label: 'Переместить', run: () => move([item.id]) },
    { icon: 'copy', label: 'Копировать', run: () => copy([item.id]) },
    {
      icon: item.favorite ? 'heartFill' : 'heart',
      label: item.favorite ? 'Убрать из избранного' : 'В избранное',
      run: () => toggleFav([item.id], !item.favorite),
    },
    { icon: 'share', label: 'Поделиться', run: () => share(item) },
    { icon: 'trash', label: 'Удалить', danger: true, run: () => remove([item.id], onDeleted) },
  ].filter(Boolean);

  const menu = (item, opts = {}) =>
    ui.open({ type: 'actions', item, actions: itemActions(item, opts) });

  // Быстрый просмотр по долгому нажатию.
  const peek = (item, opts = {}) =>
    ui.open({
      type: 'peek',
      item,
      onOpen: () => open(item, opts.list || []),
      actions: itemActions(item, opts),
    });

  // Быстрые действия смахиванием по строке.
  const swipe = (item) => [
    {
      icon: item.favorite ? 'heartFill' : 'heart',
      label: item.favorite ? 'Убрать' : 'Избранное',
      tone: 'accent',
      run: () => toggleFav([item.id], !item.favorite),
    },
    { icon: 'trash', label: 'Удалить', tone: 'danger', run: () => remove([item.id]) },
  ];

  return { open, menu, peek, swipe, itemActions, caption, edit, saveGallery, remove, rename, move, copy, toggleFav, share };
}
