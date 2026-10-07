import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar, Thumb, Empty } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useUi, Fixed } from '../ui.jsx';
import { useActions } from '../actions.js';
import { getBlob } from '../lib/db.js';
import { fileHash } from '../lib/media.js';
import { fmtDate, fmtSize, filesWord } from '../lib/format.js';
import { CATEGORY } from '../lib/categories.js';
import { haptic } from '../lib/haptics.js';

// Поиск одинаковых файлов. Отпечатки считаются на устройстве и запоминаются в материале.
export default function Duplicates() {
  const store = useStore();
  const ui = useUi();
  const act = useActions();
  const [progress, setProgress] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [touched, setTouched] = useState(false);

  const candidates = useMemo(() => store.items.filter((i) => !i.deletedAt && i.blobId), [store.items]);

  // Досчитываем отпечатки для старых материалов.
  useEffect(() => {
    const missing = candidates.filter((i) => !i.hash);
    if (!missing.length) return undefined;
    let alive = true;
    (async () => {
      // Отпечатки сохраняются пачками — на большом архиве не перерисовываем всё после каждого файла.
      let batch = {};
      const flush = () => { if (Object.keys(batch).length && alive) store.patchItems(batch); batch = {}; };
      for (let k = 0; k < missing.length && alive; k++) {
        if (k % 10 === 0) setProgress({ done: k, total: missing.length });
        try {
          const b = await getBlob(missing[k].blobId);
          const h = await fileHash(b);
          if (h) batch[missing[k].id] = { hash: h };
        } catch { /* пропускаем */ }
        if (k % 25 === 24) flush();
      }
      flush();
      if (alive) setProgress(null);
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const by = new Map();
    candidates.forEach((i) => {
      if (!i.hash) return;
      if (!by.has(i.hash)) by.set(i.hash, []);
      by.get(i.hash).push(i);
    });
    return [...by.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.createdAt - b.createdAt));
  }, [candidates]);

  // По умолчанию отмечены все копии, кроме самой ранней.
  useEffect(() => {
    if (touched || progress) return;
    setSel(new Set(groups.flatMap((g) => g.slice(1).map((i) => i.id))));
  }, [groups.length, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => {
    haptic('selection');
    setTouched(true);
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const ids = [...sel].filter((id) => store.byId[id] && !store.byId[id].deletedAt);
  const saved = ids.reduce((s, id) => s + (store.byId[id]?.size || 0), 0);
  const folderName = (i) => store.folderById(i.folderId)?.name || 'Без папки';

  const removeSelected = () =>
    ui.confirm({
      title: 'Удалить дубликаты?',
      text: `${filesWord(ids.length)} (${fmtSize(saved)}) будут перемещены в Корзину. Оттуда их можно восстановить.`,
      okText: 'В корзину',
      onOk: () => { act.remove(ids); setSel(new Set()); },
    });

  return (
    <div className={`screen ${groups.length ? 'with-selbar' : ''}`}>
      <TopBar title="Дубликаты" sub={progress ? `Проверка… ${progress.done} из ${progress.total}` : groups.length ? `${groups.length} ${groups.length === 1 ? 'группа' : 'групп(ы)'}` : undefined} />
      {progress && <div className="storage-bar slim"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>}
      {!groups.length && !progress && (
        <Empty icon="duplicate" title="Дубликатов нет" text="Одинаковые фото, видео и голосовые не найдены." />
      )}
      {groups.length > 0 && (
        <p className="hint">Отмечены копии, кроме самой ранней. Коснитесь, чтобы изменить выбор.</p>
      )}
      <div className="list">
        {groups.map((g) => (
          <section key={g[0].hash} className="dup-group">
            <div className="dup-head">
              <span>{CATEGORY[g[0].type]?.title} • {fmtSize(g[0].size)}</span>
              <span>{g.length} одинаковых</span>
            </div>
            <div className="dup-items">
              {g.map((i, k) => (
                <button key={i.id} className={`dup-item ${sel.has(i.id) ? 'on' : ''}`} onClick={() => toggle(i.id)}>
                  <div className="dup-thumb">
                    <Thumb item={i} />
                    <span className={`sel-mark ${sel.has(i.id) ? 'on' : ''}`}>{sel.has(i.id) && <Icon name="check" size={14} />}</span>
                    {k === 0 && <span className="dup-badge">Оригинал</span>}
                  </div>
                  <b>{folderName(i)}</b>
                  <small>{fmtDate(i.createdAt)}</small>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {groups.length > 0 && (
        <Fixed>
          <div className="sel-bar">
            <button className="btn danger wide" disabled={!ids.length} onClick={removeSelected}>
              <Icon name="trash" size={18} />{ids.length ? `Удалить ${filesWord(ids.length)} • ${fmtSize(saved)}` : 'Ничего не выбрано'}
            </button>
          </div>
        </Fixed>
      )}
    </div>
  );
}
