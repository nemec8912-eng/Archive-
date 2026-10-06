import React, { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useNav, useUi } from '../ui.jsx';
import { filesWord } from '../lib/format.js';

export function FolderRow({ folder, count, onOpen, onMore, right }) {
  return (
    <div className="folder-row">
      <button className="folder-main" onClick={onOpen}>
        <span className="folder-icon"><Icon name="folderFill" size={30} /></span>
        <span className="row-text">
          <b>{folder.name}</b>
          <span>{filesWord(count)}</span>
        </span>
      </button>
      {right || (onMore && (
        <button className="icon-btn" onClick={onMore} aria-label="Действия с папкой"><Icon name="more" size={22} /></button>
      ))}
    </div>
  );
}

export default function Folders() {
  const store = useStore();
  const nav = useNav();
  const ui = useUi();
  const [sort, setSort] = useState('created');

  const counts = {};
  store.items.forEach((i) => { if (!i.deletedAt && i.folderId) counts[i.folderId] = (counts[i.folderId] || 0) + 1; });
  const folders = store.folders
    .filter((f) => !f.hidden)
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'ru') : a.createdAt - b.createdAt));
  const trashCount = store.trashItems.length;

  const folderMenu = (f) =>
    ui.open({
      type: 'menu',
      title: f.name,
      actions: [
        { icon: 'open', label: 'Открыть', run: () => nav.push({ name: 'collection', kind: 'folder', folderId: f.id }) },
        {
          icon: 'pencil',
          label: 'Переименовать',
          run: () => ui.prompt({ title: 'Переименовать папку', value: f.name, okText: 'Сохранить', onOk: (n) => n.trim() && store.renameFolder(f.id, n.trim()) }),
        },
        {
          icon: 'trash',
          label: 'Удалить папку',
          danger: true,
          run: () =>
            ui.confirm({
              title: `Удалить папку «${f.name}»?`,
              text: counts[f.id] ? `Материалы папки (${filesWord(counts[f.id])}) будут перемещены в Корзину.` : 'Папка пустая.',
              onOk: () => { store.deleteFolder(f.id); ui.showToast('Папка удалена'); },
            }),
        },
      ],
    });

  return (
    <div className="screen with-nav">
      <TopBar
        title="Папки"
        back={false}
        right={
          <button className="icon-btn" onClick={() => setSort(sort === 'name' ? 'created' : 'name')} aria-label="Сортировка">
            <Icon name="sort" size={20} />
          </button>
        }
      />
      {sort === 'name' && <p className="hint">Сортировка по названию</p>}
      <div className="list">
        {folders.map((f) => (
          <FolderRow
            key={f.id}
            folder={f}
            count={counts[f.id] || 0}
            onOpen={() => nav.push({ name: 'collection', kind: 'folder', folderId: f.id })}
            onMore={() => folderMenu(f)}
          />
        ))}
        {!folders.length && <p className="hint">Папок пока нет. Создайте папку через кнопку «+».</p>}
        <div className="folder-row">
          <button className="folder-main" onClick={() => nav.push({ name: 'trash' })}>
            <span className="folder-icon trash"><Icon name="trash" size={24} /></span>
            <span className="row-text">
              <b>Корзина</b>
              <span>{filesWord(trashCount)}</span>
            </span>
          </button>
          <span className="icon-btn muted"><Icon name="chevron" size={20} /></span>
        </div>
      </div>
    </div>
  );
}
