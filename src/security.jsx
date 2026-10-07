import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadSecurity, saveSecurity, checkPin } from './lib/security.js';
import { setDataKey, setRequireKey, rekeyAll } from './lib/db.js';
import { newDataKey, wrapWithPin, unwrapWithPin, enrollBiometric, unlockBiometric, removeBiometric } from './lib/vault.js';
import { clearThumbCache } from './lib/hooks.js';
import { externalRecently, clearExternal } from './lib/external.js';

const SecCtx = createContext(null);
const LOG_KEY = 'archive.attempts';
const LOG_MAX = 100;

// Журнал неверных попыток входа (только время и способ, без введённых цифр).
export function loadAttempts() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY)) || { list: [], seenAt: 0 }; } catch { return { list: [], seenAt: 0 }; }
}
function saveAttempts(v) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(v)); } catch { /* */ }
}

export const AUTOLOCK = [
  { s: 0, label: 'Сразу' },
  { s: 60, label: 'Через 1 минуту' },
  { s: 300, label: 'Через 5 минут' },
  { s: 900, label: 'Через 15 минут' },
  { s: 3600, label: 'Через 1 час' },
];

// Блокировка и шифрование: код запрашивается при запуске, при возвращении в приложение
// и по таймеру; пока архив заблокирован, ключа данных нет в памяти.
export function SecurityProvider({ children }) {
  const [sec, setSec] = useState(loadSecurity);
  const [locked, setLocked] = useState(() => !!loadSecurity().lockEnabled);
  const [busy, setBusy] = useState(null); // { text, done, total } — перешифрование
  const [attempts, setAttempts] = useState(loadAttempts);
  const [privacy, setPrivacy] = useState(false);
  const dek = useRef(null);
  const flushers = useRef(new Set());
  const hiddenAt = useRef(0);
  const lastActive = useRef(Date.now());
  const secRef = useRef(sec);
  secRef.current = sec;

  useEffect(() => { setRequireKey(!!sec.lockEnabled); }, [sec.lockEnabled]);

  const update = (next) => { saveSecurity(next); setSec(next); secRef.current = next; };

  const flush = async () => {
    // Сначала — открытые окна (запись голосового и т. п.), в конце — сохранение самого архива.
    for (const f of [...flushers.current].reverse()) { try { await f(); } catch { /* */ } }
  };

  const lock = useCallback(async () => {
    if (!secRef.current.lockEnabled || !dek.current) return;
    await flush();
    dek.current = null;
    setDataKey(null);
    clearThumbCache();
    setLocked(true);
  }, []);

  const opened = (key) => {
    dek.current = key;
    setDataKey(key);
    lastActive.current = Date.now();
    setLocked(false);
  };

  const logFail = (method) => {
    const v = loadAttempts();
    v.list = [{ at: Date.now(), method }, ...v.list].slice(0, LOG_MAX);
    saveAttempts(v);
    setAttempts(v);
  };

  // ── автозамок: при сворачивании и при бездействии ──
  useEffect(() => {
    if (!sec.lockEnabled) return undefined;
    const limit = (sec.autoLock ?? 0) * 1000;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        if (limit === 0 && !externalRecently()) lock();
      } else {
        const away = Date.now() - hiddenAt.current;
        const ext = externalRecently();
        clearExternal();
        if (hiddenAt.current && (away >= limit || (limit === 0 && (!ext || away > 300000)))) lock();
        hiddenAt.current = 0;
        lastActive.current = Date.now();
      }
    };
    const onAct = () => { lastActive.current = Date.now(); };
    const tick = setInterval(() => {
      if (limit > 0 && document.visibilityState === 'visible' && Date.now() - lastActive.current >= limit) lock();
    }, 10000);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pointerdown', onAct, true);
    window.addEventListener('keydown', onAct, true);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointerdown', onAct, true);
      window.removeEventListener('keydown', onAct, true);
    };
  }, [sec.lockEnabled, sec.autoLock, lock]);

  // ── скрытие содержимого при сворачивании (в переключателе приложений) ──
  useEffect(() => { window.ArchiveNative?.setPrivacy(sec.privacy !== false); }, [sec.privacy]);
  useEffect(() => {
    if (sec.privacy === false) return undefined;
    const hide = () => setPrivacy(true);
    const show = () => { if (document.visibilityState === 'visible' && document.hasFocus()) setPrivacy(false); };
    const onVis = () => (document.visibilityState === 'hidden' ? hide() : show());
    const onBlur = () => { if (!externalRecently(3000)) hide(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', hide);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', show);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', show);
    };
  }, [sec.privacy]);

  const progress = (text) => (done, total) => setBusy({ text, done, total });

  const api = useMemo(() => ({
    sec,
    locked: locked && !!sec.lockEnabled,
    busy,
    privacy: privacy && sec.privacy !== false,
    attempts,
    encrypted: !!sec.lockEnabled && sec.v === 2,
    registerFlush(fn) { flushers.current.add(fn); return () => flushers.current.delete(fn); },
    lock,

    async unlock(pin) {
      const s = secRef.current;
      if (s.v === 2) {
        const key = await unwrapWithPin(pin, s);
        if (!key) { logFail('code'); return false; }
        opened(key);
        return true;
      }
      // Старая запись (только хеш кода): проверяем и сразу включаем шифрование.
      if (!(await checkPin(pin, s))) { logFail('code'); return false; }
      const key = await newDataKey();
      setBusy({ text: 'Шифрование архива…', done: 0, total: 1 });
      await rekeyAll(null, key, progress('Шифрование архива…'));
      update({ lockEnabled: true, autoLock: s.autoLock ?? 0, privacy: s.privacy, ...(await wrapWithPin(pin, key)) });
      setBusy(null);
      opened(key);
      return true;
    },

    async unlockBio() {
      const s = secRef.current;
      if (!s.bio) return false;
      try {
        const key = await unlockBiometric(s.bio);
        opened(key);
        return true;
      } catch (e) {
        if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError' && !/cancel/i.test(e?.message || '')) logFail('biometric');
        return false;
      }
    },

    async verify(pin) {
      const s = secRef.current;
      return s.v === 2 ? !!(await unwrapWithPin(pin, s)) : checkPin(pin, s);
    },

    // Включение блокировки или смена кода. При включении всё содержимое шифруется.
    async setPin(pin) {
      const s = secRef.current;
      if (s.lockEnabled && s.v === 2 && dek.current) {
        update({ ...s, ...(await wrapWithPin(pin, dek.current)) });
        return;
      }
      await flush();
      const key = await newDataKey();
      setBusy({ text: 'Шифрование архива…', done: 0, total: 1 });
      setDataKey(key);
      await rekeyAll(null, key, progress('Шифрование архива…'));
      dek.current = key;
      update({ lockEnabled: true, autoLock: s.autoLock ?? 0, privacy: s.privacy, ...(await wrapWithPin(pin, key)) });
      await flush();
      setBusy(null);
    },

    async disableLock() {
      const s = secRef.current;
      await flush();
      if (dek.current) {
        setBusy({ text: 'Снятие шифрования…', done: 0, total: 1 });
        const key = dek.current;
        setDataKey(null);
        setRequireKey(false);
        await rekeyAll(key, null, progress('Снятие шифрования…'));
        setBusy(null);
      }
      await removeBiometric(s.bio);
      dek.current = null;
      setDataKey(null);
      update({ lockEnabled: false, autoLock: s.autoLock ?? 0, privacy: s.privacy });
      await flush();
    },

    async enableBio() {
      if (!dek.current) return false;
      const bio = await enrollBiometric(dek.current);
      update({ ...secRef.current, bio });
      return true;
    },
    async disableBio() {
      await removeBiometric(secRef.current.bio);
      const { bio, ...rest } = secRef.current; // eslint-disable-line no-unused-vars
      update(rest);
    },
    setAutoLock(s) { update({ ...secRef.current, autoLock: s }); },
    setPrivacyOn(v) { update({ ...secRef.current, privacy: v }); },
    markAttemptsSeen() {
      const v = { ...loadAttempts(), seenAt: Date.now() };
      saveAttempts(v);
      setAttempts(v);
    },
    clearAttempts() {
      const v = { list: [], seenAt: Date.now() };
      saveAttempts(v);
      setAttempts(v);
    },
  }), [sec, locked, busy, privacy, attempts, lock]); // eslint-disable-line react-hooks/exhaustive-deps

  return <SecCtx.Provider value={api}>{children}</SecCtx.Provider>;
}

export const useSecurity = () => useContext(SecCtx);
