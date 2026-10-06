import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const NavCtx = createContext(null);
const UiCtx = createContext(null);

export const TABS = ['home', 'folders', 'favorites', 'settings'];

// Простая навигация стеком экранов; кнопка «Назад» Android/жест iOS поддерживаются через history.
export function NavProvider({ children }) {
  const [stack, setStack] = useState([{ name: 'home' }]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  useEffect(() => {
    const onPop = () => {
      setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const api = useMemo(() => ({
    stack,
    top: stack[stack.length - 1],
    tab: stack[0].name,
    push(route) {
      window.history.pushState({ d: stackRef.current.length }, '');
      setStack((s) => [...s, route]);
    },
    replace(route) {
      setStack((s) => [...s.slice(0, -1), route]);
    },
    back() {
      if (stackRef.current.length > 1) window.history.back();
    },
    goTab(name) {
      const extra = stackRef.current.length - 1;
      setStack([{ name }]);
      if (extra > 0) window.history.go(-extra);
    },
  }), [stack]);

  return <NavCtx.Provider value={api}>{children}</NavCtx.Provider>;
}

export function UiProvider({ children }) {
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  const showToast = useCallback((text, action, ms = 3200) => {
    clearTimeout(toastTimer.current);
    setToast({ text, action, key: Date.now() });
    if (ms) toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const api = useMemo(() => ({
    sheet,
    open: (s) => setSheet(s),
    close: () => setSheet(null),
    confirm: (opts) => setSheet({ type: 'confirm', ...opts }),
    prompt: (opts) => setSheet({ type: 'prompt', ...opts }),
    pickFolder: (opts) => setSheet({ type: 'folderPicker', ...opts }),
    toast,
    showToast,
    hideToast: () => setToast(null),
  }), [sheet, toast, showToast]);

  return <UiCtx.Provider value={api}>{children}</UiCtx.Provider>;
}

export const useNav = () => useContext(NavCtx);
export const useUi = () => useContext(UiCtx);
