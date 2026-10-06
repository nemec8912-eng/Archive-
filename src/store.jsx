import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { getMeta, setMeta, deleteBlobs, blobIdsOf, getBlob, saveBlob, uid, clearBlobs } from './lib/db.js';
import { DEFAULT_FOLDERS } from './lib/categories.js';

const StoreCtx = createContext(null);
export const TRASH_DAYS = 30; // материалы в корзине удаляются автоматически через 30 дней
export const RECENT_DAYS = 7; // «Недавно удалённые» — за последнюю неделю
const DAY = 86400000;
export const daysLeft = (deletedAt, now = Date.now()) => Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * DAY - now) / DAY));
const EMPTY = { folders: [], items: [] };

function seed() {
  const now = Date.now();
  const folders = DEFAULT_FOLDERS.map((name, i) => ({ id: uid(), name, createdAt: now + i, hidden: false }));
  const byName = Object.fromEntries(folders.map((f) => [f.name, f.id]));
  const t = now - 3600_000;
  const chat = {
    id: uid(),
    type: 'chat',
    name: 'Переписка_01',
    folderId: byName['Переписки'],
    createdAt: t,
    size: 0,
    favorite: false,
    deletedAt: null,
    demo: true,
    messages: [
      { id: uid(), from: 'them', kind: 'text', text: 'Привет, как дела?', time: t },
      { id: uid(), from: 'me', kind: 'text', text: 'Всё хорошо 😊', time: t + 60_000 },
      { id: uid(), from: 'them', kind: 'text', text: 'Отлично 👍', time: t + 240_000 },
    ],
  };
  const note = {
    id: uid(),
    type: 'note',
    name: 'Первая заметка',
    folderId: byName['Заметки'],
    createdAt: now,
    size: 0,
    favorite: false,
    deletedAt: null,
    demo: true,
    text: 'Первая заметка\nЭто пример. Её можно изменить или удалить.',
    attachments: [],
  };
  return { folders, items: [chat, note] };
}

export function StoreProvider({ children }) {
  const [state, setState] = useReducer((s, fn) => fn(s), EMPTY);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef();

  useEffect(() => {
    getMeta('state')
      .then((saved) => {
        setState(() => saved || seed());
        setReady(true);
      })
      .catch(() => {
        setState(() => seed());
        setReady(true);
      });
  }, []);

  // Автоудаление из корзины: при запуске и раз в час.
  useEffect(() => {
    if (!ready) return undefined;
    const sweep = () => {
      const limit = Date.now() - TRASH_DAYS * DAY;
      setState((s) => {
        const old = s.items.filter((i) => i.deletedAt && i.deletedAt < limit);
        if (!old.length) return s;
        deleteBlobs(old.flatMap(blobIdsOf)).catch(() => {});
        const gone = new Set(old.map((i) => i.id));
        return { ...s, items: s.items.filter((i) => !gone.has(i.id)) };
      });
    };
    sweep();
    const t = setInterval(sweep, 3600_000);
    return () => clearInterval(t);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setMeta('state', state), 250);
  }, [state, ready]);

  const mapItems = useCallback((ids, fn) => {
    const set = new Set(ids);
    setState((s) => ({ ...s, items: s.items.map((it) => (set.has(it.id) ? fn(it) : it)) }));
  }, []);

  const api = useMemo(() => {
    const hiddenIds = new Set(state.folders.filter((f) => f.hidden).map((f) => f.id));
    const visible = state.items.filter((i) => !i.deletedAt && !hiddenIds.has(i.folderId));
    const byId = Object.fromEntries(state.items.map((i) => [i.id, i]));

    return {
      ready,
      state,
      folders: state.folders,
      items: state.items,
      visible,
      byId,
      trashItems: state.items.filter((i) => i.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt),
      recentItems: state.items.filter((i) => i.deletedAt && i.deletedAt > Date.now() - RECENT_DAYS * DAY).sort((a, b) => b.deletedAt - a.deletedAt),
      folderById: (id) => state.folders.find((f) => f.id === id),

      addItems(list) {
        if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
        setState((s) => ({ ...s, items: [...list, ...s.items] }));
      },
      updateItem(id, patch) {
        mapItems([id], (it) => ({ ...it, ...patch }));
      },
      rename(id, name) {
        mapItems([id], (it) => ({ ...it, name }));
      },
      setFavorite(ids, value) {
        mapItems(ids, (it) => ({ ...it, favorite: value }));
      },
      move(ids, folderId) {
        mapItems(ids, (it) => ({ ...it, folderId: folderId || null }));
      },
      async copy(ids, folderId) {
        const copies = [];
        for (const id of ids) {
          const it = byId[id];
          if (!it) continue;
          const dup = async (bid) => (bid ? saveBlob(await getBlob(bid)) : bid);
          copies.push({
            ...it,
            id: uid(),
            name: `${it.name} (копия)`,
            folderId: folderId || null,
            createdAt: Date.now(),
            favorite: false,
            blobId: await dup(it.blobId),
            thumbId: await dup(it.thumbId),
            attachments: it.attachments
              ? await Promise.all(it.attachments.map(async (a) => ({ ...a, blobId: await dup(a.blobId), thumbId: await dup(a.thumbId) })))
              : it.attachments,
            messages: it.messages
              ? await Promise.all(it.messages.map(async (m) => ({ ...m, blobId: await dup(m.blobId), thumbId: await dup(m.thumbId) })))
              : it.messages,
          });
        }
        setState((s) => ({ ...s, items: [...copies, ...s.items] }));
      },

      // Обычное удаление — только перемещение в корзину (ТЗ, п. 16).
      trash(ids) {
        const now = Date.now();
        mapItems(ids, (it) => ({ ...it, deletedAt: now, originFolderId: it.folderId }));
      },
      restore(ids) {
        setState((s) => {
          const exists = new Set(s.folders.map((f) => f.id));
          const set = new Set(ids);
          return {
            ...s,
            items: s.items.map((it) =>
              set.has(it.id)
                ? { ...it, deletedAt: null, folderId: exists.has(it.originFolderId) ? it.originFolderId : null, originFolderId: undefined }
                : it
            ),
          };
        });
      },
      // Окончательное удаление — только из корзины и только после подтверждения.
      purge(ids) {
        const set = new Set(ids);
        const victims = state.items.filter((i) => set.has(i.id) && i.deletedAt);
        deleteBlobs(victims.flatMap(blobIdsOf)).catch(() => {});
        setState((s) => ({ ...s, items: s.items.filter((i) => !(set.has(i.id) && i.deletedAt)) }));
      },
      emptyTrash() {
        const victims = state.items.filter((i) => i.deletedAt);
        deleteBlobs(victims.flatMap(blobIdsOf)).catch(() => {});
        setState((s) => ({ ...s, items: s.items.filter((i) => !i.deletedAt) }));
      },

      createFolder(name) {
        const f = { id: uid(), name, createdAt: Date.now(), hidden: false };
        setState((s) => ({ ...s, folders: [...s.folders, f] }));
        return f.id;
      },
      renameFolder(id, name) {
        setState((s) => ({ ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) }));
      },
      setFolderHidden(id, hidden) {
        setState((s) => ({ ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, hidden } : f)) }));
      },
      // Папка удаляется, её материалы уходят в корзину.
      deleteFolder(id) {
        const now = Date.now();
        setState((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          items: s.items.map((it) =>
            it.folderId === id && !it.deletedAt ? { ...it, deletedAt: now, originFolderId: id, folderId: null } : it
          ),
        }));
      },
      replaceAll(next) {
        setState(() => ({ folders: next.folders || [], items: next.items || [] }));
      },
      // Полный сброс: все материалы и папки удаляются, архив начинается заново.
      async resetAll() {
        await clearBlobs();
        setState(() => seed());
      },
      // Добавление папок из файла экспорта; одинаковые имена получают номер.
      importBundle(folders, items) {
        setState((s) => {
          const names = new Set(s.folders.map((f) => f.name));
          const idMap = {};
          const nf = folders.map((f) => {
            let name = f.name;
            for (let k = 2; names.has(name); k++) name = `${f.name} (${k})`;
            names.add(name);
            const id = uid();
            idMap[f.id] = id;
            return { ...f, id, name, createdAt: Date.now() };
          });
          const ni = items.map((it) => ({ ...it, id: uid(), folderId: idMap[it.folderId] || null, deletedAt: null, originFolderId: undefined }));
          return { folders: [...s.folders, ...nf], items: [...ni, ...s.items] };
        });
      },
    };
  }, [state, ready, mapItems]);

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}

export const useStore = () => useContext(StoreCtx);
