import React from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar, ItemRow, Empty } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useUi } from '../ui.jsx';
import { fmtDate, filesWord } from '../lib/format.js';
import { haptic } from '../lib/haptics.js';

// Корзина (ТЗ, п. 16): восстановить, удалить навсегда, очистить — только с подтверждением.
export default function Trash() {
  const store = useStore();
  const ui = useUi();
  const items = store.trashItems;

  const originName = (it) => store.folderById(it.originFolderId)?.name;

  const purgeOne = (it) =>
    ui.confirm({
      title: 'Удалить навсегда?',
      text: `«${it.name}» будет удалён окончательно. Восстановить его будет невозможно.`,
      okText: 'Удалить навсегда',
      onOk: () => { store.purge([it.id]); ui.showToast('Удалено навсегда'); },
    });

  const restoreOne = (it) => {
    haptic('success');
    store.restore([it.id]);
    ui.showToast(originName(it) ? `Восстановлено в «${originName(it)}»` : 'Восстановлено');
  };

  const emptyAll = () =>
    ui.confirm({
      title: 'Очистить корзину?',
      text: `Все материалы в корзине (${filesWord(items.length)}) будут удалены окончательно. Восстановить их будет невозможно.`,
      okText: 'Очистить',
      onOk: () => { store.emptyTrash(); ui.showToast('Корзина очищена'); },
    });

  return (
    <div className="screen with-nav">
      <TopBar
        title="Корзина"
        sub={filesWord(items.length)}
        right={items.length > 0 && <button className="link-btn danger" onClick={emptyAll}>Очистить</button>}
      />
      {!items.length ? (
        <Empty icon="trash" title="Корзина пуста" text="Удалённые материалы попадают сюда. Их можно восстановить или удалить навсегда." />
      ) : (
        <>
          <p className="hint">Материалы хранятся в корзине, пока вы не удалите их навсегда.</p>
          <div className="list">
            {items.map((it) => (
              <div key={it.id} className="trash-item">
                <ItemRow
                  item={it}
                  meta={`Удалено ${fmtDate(it.deletedAt)}${originName(it) ? ` • из «${originName(it)}»` : ''}`}
                  swipe={[
                    { icon: 'restore', label: 'Вернуть', tone: 'accent', run: () => restoreOne(it) },
                    { icon: 'trash', label: 'Навсегда', tone: 'danger', run: () => purgeOne(it) },
                  ]}
                />
                <div className="trash-actions">
                  <button className="btn soft" onClick={() => restoreOne(it)}>
                    <Icon name="restore" size={18} />Восстановить
                  </button>
                  <button className="btn soft danger" onClick={() => purgeOne(it)}>
                    <Icon name="trash" size={18} />Удалить навсегда
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
