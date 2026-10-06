import { useEffect } from 'react';
import { useStore } from '../store.jsx';
import { useNav, useUi } from '../ui.jsx';
import { usePrefs } from '../prefs.jsx';
import { fmtSize } from '../lib/format.js';

const DAY = 86400000;
export const LOW_SPACE = 300 * 1024 * 1024; // меньше 300 МБ свободно — предупреждаем

export async function freeSpace() {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e?.quota) return null;
    return { free: Math.max(0, e.quota - (e.usage || 0)), quota: e.quota, usage: e.usage || 0 };
  } catch {
    return null;
  }
}

export const isLow = (s) => !!s && (s.free < LOW_SPACE || s.usage / s.quota > 0.9);

// Фоновые проверки при запуске: нехватка места и напоминание о резервной копии.
export default function Housekeeping() {
  const store = useStore();
  const nav = useNav();
  const ui = useUi();
  const prefs = usePrefs();

  useEffect(() => {
    if (!prefs.onboarded) return undefined;
    const t = setTimeout(async () => {
      const now = Date.now();
      const space = await freeSpace();
      if (isLow(space) && now - (prefs.lastSpaceWarn || 0) > DAY) {
        prefs.set({ lastSpaceWarn: now });
        ui.showToast(`Мало места на устройстве: свободно ≈ ${fmtSize(space.free)}`, { label: 'Подробнее', run: () => nav.push({ name: 'storage' }) }, 7000);
        return;
      }
      const every = prefs.backupEvery ?? 14;
      if (!every) return;
      const mine = store.items.filter((i) => !i.demo && !i.deletedAt);
      if (!mine.length) return;
      const since = prefs.lastBackupAt || Math.min(...mine.map((i) => i.createdAt));
      const due = now - since > every * DAY || (!prefs.lastBackupAt && now - since > 3 * DAY);
      if (due && now - (prefs.lastBackupRemind || 0) > 3 * DAY) {
        prefs.set({ lastBackupRemind: now });
        ui.showToast(
          prefs.lastBackupAt ? 'Пора обновить резервную копию' : 'Резервной копии ещё нет',
          { label: 'Создать', run: () => nav.push({ name: 'backup' }) },
          7000,
        );
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [prefs.onboarded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
