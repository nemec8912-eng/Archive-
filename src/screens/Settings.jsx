import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar, Toggle } from '../components/Common.jsx';
import { FolderRow } from './Folders.jsx';
import { useStore } from '../store.jsx';
import { useNav, useUi } from '../ui.jsx';
import { useSecurity } from '../security.jsx';
import { createBackup, readBackup, restoreBackup } from '../lib/backup.js';
import { downloadBlob } from '../lib/media.js';
import { fmtSize, fmtDate, filesWord } from '../lib/format.js';

const VERSION = '1.0.0';

function Row({ icon, label, value, onClick, children, danger }) {
  return (
    <button className={`set-row ${danger ? 'danger' : ''}`} onClick={onClick}>
      <span className="set-icon"><Icon name={icon} size={20} /></span>
      <span className="set-label">{label}</span>
      {value != null && <span className="set-value">{value}</span>}
      {children}
      {onClick && <Icon name="chevron" size={18} className="muted" />}
    </button>
  );
}

function useStorageInfo(items) {
  const [quota, setQuota] = useState(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setQuota(e.quota || null)).catch(() => {});
  }, []);
  const used = items.reduce((s, i) => s + (i.size || 0), 0);
  return { used, quota };
}

// Настройки (ТЗ, п. 17).
export default function Settings() {
  const store = useStore();
  const nav = useNav();
  const ui = useUi();
  const sec = useSecurity();
  const { used, quota } = useStorageInfo(store.items);
  const pct = quota ? Math.min(100, Math.max(1, (used / quota) * 100)) : 0;
  const hiddenCount = store.folders.filter((f) => f.hidden).length;

  return (
    <div className="screen with-nav">
      <TopBar title="Настройки" back={false} />

      <h4 className="set-group">Безопасность</h4>
      <div className="set-card">
        <Row
          icon="lock"
          label="Блокировка приложения"
          value={sec.sec.lockEnabled ? 'Вкл.' : 'Выкл.'}
          onClick={() => nav.push({ name: 'pin', mode: sec.sec.lockEnabled ? 'disable' : 'setup' })}
        />
        <Row
          icon="shield"
          label="Сменить код доступа"
          onClick={() => (sec.sec.lockEnabled ? nav.push({ name: 'pin', mode: 'change' }) : nav.push({ name: 'pin', mode: 'setup' }))}
        />
        <Row icon="hidden" label="Скрытые папки" value={hiddenCount || null} onClick={() => nav.push({ name: 'hidden' })} />
      </div>

      <h4 className="set-group">Хранилище</h4>
      <div className="set-card">
        <div className="set-row static">
          <span className="set-icon"><Icon name="storage" size={20} /></span>
          <span className="set-label">Использовано</span>
          <span className="set-value">{fmtSize(used)}{quota ? ` из ${fmtSize(quota)}` : ''}</span>
        </div>
        <div className="storage-bar"><i style={{ width: `${pct}%` }} /></div>
        <Row icon="backup" label="Резервное копирование" onClick={() => nav.push({ name: 'backup' })} />
      </div>

      <h4 className="set-group">О приложении</h4>
      <div className="set-card">
        <div className="set-row static">
          <span className="set-icon"><Icon name="info" size={20} /></span>
          <span className="set-label">Версия</span>
          <span className="set-value">{VERSION}</span>
        </div>
        <Row icon="help" label="Помощь и поддержка" onClick={() => ui.open({ type: 'help' })} />
      </div>
    </div>
  );
}

// Скрытые папки: их содержимое не видно в категориях, поиске, избранном и списке папок.
export function HiddenFolders() {
  const store = useStore();
  const nav = useNav();
  const counts = {};
  store.items.forEach((i) => { if (!i.deletedAt && i.folderId) counts[i.folderId] = (counts[i.folderId] || 0) + 1; });
  return (
    <div className="screen">
      <TopBar title="Скрытые папки" />
      <p className="hint">Содержимое скрытой папки не показывается в категориях, поиске, избранном и списке папок. Открыть её можно только здесь.</p>
      <div className="list">
        {store.folders.map((f) => (
          <FolderRow
            key={f.id}
            folder={f}
            count={counts[f.id] || 0}
            onOpen={() => nav.push({ name: 'collection', kind: 'folder', folderId: f.id })}
            right={
              <button className="toggle-btn" onClick={() => store.setFolderHidden(f.id, !f.hidden)} aria-label={f.hidden ? 'Показать' : 'Скрыть'}>
                <Toggle on={f.hidden} />
              </button>
            }
          />
        ))}
        {!store.folders.length && <p className="hint">Папок пока нет.</p>}
      </div>
    </div>
  );
}

// Резервная копия — файл на устройстве, который можно сохранить в надёжное место.
export function Backup() {
  const store = useStore();
  const ui = useUi();
  const [busy, setBusy] = useState('');
  const input = useRef();

  const make = async () => {
    setBusy('Создание копии…');
    try {
      const { blob, name } = await createBackup(store.state);
      const file = new File([blob], name, { type: 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name }).catch(() => {});
      } else {
        downloadBlob(file, name);
      }
      ui.showToast(`Копия создана: ${fmtSize(blob.size)}`);
    } catch {
      ui.showToast('Не удалось создать копию');
    }
    setBusy('');
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { header } = await readBackup(file);
      const n = (header.state.items || []).length;
      ui.confirm({
        title: 'Восстановить из копии?',
        text: `Копия от ${fmtDate(header.createdAt)}, ${filesWord(n)}. Текущее содержимое архива будет заменено содержимым копии.`,
        okText: 'Восстановить',
        onOk: async () => {
          setBusy('Восстановление…');
          try {
            const state = await restoreBackup(file);
            store.replaceAll(state);
            ui.showToast('Архив восстановлен');
          } catch {
            ui.showToast('Не удалось восстановить копию');
          }
          setBusy('');
        },
      });
    } catch {
      ui.showToast('Это не файл резервной копии Архива');
    }
  };

  return (
    <div className="screen">
      <TopBar title="Резервное копирование" />
      <p className="hint">
        Материалы хранятся только на этом устройстве. Создайте файл резервной копии и сохраните его в надёжное место —
        он понадобится, если телефон будет заменён или данные приложения очистятся.
      </p>
      <div className="set-card">
        <Row icon="download" label="Создать резервную копию" onClick={busy ? undefined : make} />
        <Row icon="upload" label="Восстановить из копии" onClick={busy ? undefined : () => input.current.click()} />
      </div>
      {busy && <p className="hint">{busy}</p>}
      <input ref={input} type="file" hidden onChange={pick} />
    </div>
  );
}
