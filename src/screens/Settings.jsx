import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar, Toggle } from '../components/Common.jsx';
import { FolderRow } from './Folders.jsx';
import { useStore } from '../store.jsx';
import { useNav, useUi } from '../ui.jsx';
import { useSecurity, AUTOLOCK } from '../security.jsx';
import { biometricAvailable } from '../lib/vault.js';
import { markExternal } from '../lib/external.js';
import { usePrefs, ACCENTS } from '../prefs.jsx';
import { haptic } from '../lib/haptics.js';
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
  const prefs = usePrefs();

  const toggleBio = async () => {
    if (sec.sec.bio) { await sec.disableBio(); ui.showToast('Вход по биометрии выключен'); return; }
    const av = await biometricAvailable();
    if (!av) { ui.showToast('Биометрия на этом устройстве недоступна', null, 4500); return; }
    try {
      await sec.enableBio();
      haptic('success');
      ui.showToast('Вход по биометрии включён');
    } catch (e) {
      haptic('error');
      ui.showToast(e?.code === 'noprf'
        ? 'В браузере вход по биометрии здесь недоступен — он будет работать в установленном приложении'
        : 'Биометрия не подтверждена', null, 5000);
    }
  };

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
        {sec.sec.lockEnabled && (
          <>
            <button className="set-row" onClick={toggleBio} role="switch" aria-checked={!!sec.sec.bio}>
              <span className="set-icon"><Icon name="faceId" size={20} /></span>
              <span className="set-label">Вход по Face ID или отпечатку</span>
              <Toggle on={!!sec.sec.bio} />
            </button>
            <Row
              icon="history"
              label="Автоблокировка"
              value={AUTOLOCK.find((x) => x.s === (sec.sec.autoLock ?? 0))?.label}
              onClick={() => ui.open({
                type: 'menu',
                title: 'Блокировать архив',
                actions: AUTOLOCK.map((x) => ({
                  icon: x.s === (sec.sec.autoLock ?? 0) ? 'check' : 'history',
                  label: x.s === 0 ? 'Сразу при сворачивании' : `${x.label} без действий`,
                  run: () => sec.setAutoLock(x.s),
                })),
              })}
            />
          </>
        )}
        <button className="set-row" onClick={() => sec.setPrivacyOn(sec.sec.privacy === false)} role="switch" aria-checked={sec.sec.privacy !== false}>
          <span className="set-icon"><Icon name="eyeOff" size={20} /></span>
          <span className="set-label">Скрывать при сворачивании</span>
          <Toggle on={sec.sec.privacy !== false} />
        </button>
        <Row icon="key" label="Неверные попытки входа" value={sec.attempts.list.length || null} onClick={() => ui.open({ type: 'attempts' })} />
        <Row icon="hidden" label="Скрытые папки" value={hiddenCount || null} onClick={() => nav.push({ name: 'hidden' })} />
      </div>
      <p className="hint set-note">
        {sec.encrypted
          ? 'Материалы зашифрованы на устройстве (AES-256). Ключ открывается только кодом доступа или биометрией.'
          : 'Включите блокировку — материалы будут зашифрованы на устройстве ключом из кода доступа.'}
      </p>

      <h4 className="set-group">Хранилище</h4>
      <div className="set-card">
        <Row icon="storage" label="Занятое место" value={`${fmtSize(used)}${quota ? ` из ${fmtSize(quota)}` : ''}`} onClick={() => nav.push({ name: 'storage' })} />
        <div className="storage-bar"><i style={{ width: `${pct}%` }} /></div>
        <Row icon="backup" label="Резервное копирование" onClick={() => nav.push({ name: 'backup' })} />
      </div>

      <h4 className="set-group">Данные</h4>
      <div className="set-card">
        <Row icon="fileLock" label="Экспорт папок" onClick={() => nav.push({ name: 'export' })} />
        <Row icon="upload" label="Импорт папок" onClick={() => nav.push({ name: 'import' })} />
        <Row icon="restore" label="Недавно удалённые" value={store.recentItems.length || null} onClick={() => nav.push({ name: 'recent' })} />
        <Row
          icon="reset"
          label="Сбросить архив"
          danger
          onClick={() =>
            ui.open({
              type: 'typeConfirm',
              title: 'Сбросить архив?',
              text: 'Все материалы, папки и корзина будут удалены с этого устройства без возможности восстановления. Сначала сделайте резервную копию, если она нужна.',
              word: 'СБРОСИТЬ',
              okText: 'Сбросить',
              onOk: async () => {
                await store.resetAll();
                ui.showToast('Архив сброшен');
                nav.goTab('home');
              },
            })
          }
        />
      </div>

      <h4 className="set-group">Оформление</h4>
      <div className="set-card">
        <div className="set-row static">
          <span className="set-icon"><Icon name="palette" size={20} /></span>
          <span className="set-label">Акцентный цвет</span>
          <span className="set-value">{ACCENTS.find((a) => a.id === prefs.accent)?.title}</span>
        </div>
        <div className="swatches" role="radiogroup" aria-label="Акцентный цвет">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={prefs.accent === a.id}
              aria-label={a.title}
              className={`swatch ${prefs.accent === a.id ? 'on' : ''}`}
              style={{ '--sw': a.color }}
              onClick={() => { haptic('selection'); prefs.set({ accent: a.id }); }}
            >
              {prefs.accent === a.id && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
        <button className="set-row" onClick={() => { haptic('selection'); prefs.set({ largeFont: !prefs.largeFont }); }} role="switch" aria-checked={prefs.largeFont}>
          <span className="set-icon"><Icon name="textSize" size={20} /></span>
          <span className="set-label">Крупный шрифт</span>
          <Toggle on={prefs.largeFont} />
        </button>
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
const REMIND = [
  { days: 7, label: 'Каждую неделю' },
  { days: 14, label: 'Каждые 2 недели' },
  { days: 30, label: 'Раз в месяц' },
  { days: 0, label: 'Не напоминать' },
];

export function Backup() {
  const store = useStore();
  const ui = useUi();
  const prefs = usePrefs();
  const sec = useSecurity();
  const every = prefs.backupEvery ?? 14;
  const [busy, setBusy] = useState('');
  const input = useRef();

  const make = async () => {
    setBusy('Создание копии…');
    try {
      const { blob, name } = await createBackup(store.state);
      const file = new File([blob], name, { type: 'application/octet-stream' });
      markExternal();
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name }).catch(() => {});
      } else {
        downloadBlob(file, name);
      }
      prefs.set({ lastBackupAt: Date.now() });
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
      {sec.encrypted && (
        <p className="hint warn-hint">Файл резервной копии не зашифрован. Храните его в надёжном месте; для зашифрованного переноса используйте «Экспорт папок».</p>
      )}
      <div className="set-card">
        <Row icon="download" label="Создать резервную копию" onClick={busy ? undefined : make} />
        <Row icon="upload" label="Восстановить из копии" onClick={busy ? undefined : () => input.current.click()} />
      </div>
      <div className="set-card gap-top">
        <div className="set-row static">
          <span className="set-icon"><Icon name="info" size={20} /></span>
          <span className="set-label">Последняя копия</span>
          <span className="set-value">{prefs.lastBackupAt ? fmtDate(prefs.lastBackupAt) : 'ещё не создавалась'}</span>
        </div>
        <Row
          icon="bell"
          label="Напоминать"
          value={REMIND.find((r) => r.days === every)?.label}
          onClick={() => ui.open({
            type: 'menu',
            title: 'Напоминание о резервной копии',
            actions: REMIND.map((r) => ({ icon: r.days === every ? 'check' : 'bell', label: r.label, run: () => prefs.set({ backupEvery: r.days }) })),
          })}
        />
      </div>
      {busy && <p className="hint">{busy}</p>}
      <input ref={input} type="file" hidden onChange={pick} />
    </div>
  );
}
