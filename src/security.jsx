import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadSecurity, saveSecurity, checkPin, makePinRecord } from './lib/security.js';

const SecCtx = createContext(null);

// Блокировка приложения: код запрашивается при запуске и при возвращении в приложение.
export function SecurityProvider({ children }) {
  const [sec, setSec] = useState(loadSecurity);
  const [locked, setLocked] = useState(() => !!loadSecurity().lockEnabled);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && sec.lockEnabled) setLocked(true);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [sec.lockEnabled]);

  const api = useMemo(() => {
    const update = (next) => { saveSecurity(next); setSec(next); };
    return {
      sec,
      locked: locked && sec.lockEnabled,
      async unlock(pin) {
        const ok = await checkPin(pin, sec);
        if (ok) setLocked(false);
        return ok;
      },
      verify: (pin) => checkPin(pin, sec),
      async setPin(pin) {
        update({ ...sec, ...(await makePinRecord(pin)), lockEnabled: true });
      },
      disableLock() {
        update({ lockEnabled: false });
      },
    };
  }, [sec, locked]);

  return <SecCtx.Provider value={api}>{children}</SecCtx.Provider>;
}

export const useSecurity = () => useContext(SecCtx);
