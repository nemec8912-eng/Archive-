import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Настройки внешнего вида и интерфейса. Хранятся на устройстве, личных данных не содержат.
const KEY = 'archive.prefs';
const PrefsCtx = createContext(null);

// Акцентные цвета в пределах утверждённой тёмной темы. Первый — исходный из макета.
export const ACCENTS = [
  { id: 'blue', title: 'Синий', color: '#2f6bff' },
  { id: 'violet', title: 'Фиолетовый', color: '#7c5cff' },
  { id: 'teal', title: 'Бирюзовый', color: '#14b8a6' },
  { id: 'green', title: 'Зелёный', color: '#2fbf71' },
  { id: 'orange', title: 'Оранжевый', color: '#ff8a2f' },
  { id: 'pink', title: 'Розовый', color: '#ff4f9a' },
];

const DEFAULTS = {
  accent: 'blue',
  largeFont: false,
  onboarded: false,
  tips: {}, // показанные подсказки
  gridCols: 3,
  sorts: {}, // сортировка по папкам и категориям
};

function load() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(load);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* нет места — не критично */ }
    const el = document.documentElement;
    el.dataset.accent = prefs.accent;
    el.classList.toggle('large-font', !!prefs.largeFont);
  }, [prefs]);

  const api = useMemo(() => ({
    ...prefs,
    set: (patch) => setPrefs((p) => ({ ...p, ...patch })),
    tipSeen: (id) => !!prefs.tips[id],
    markTip: (id) => setPrefs((p) => ({ ...p, tips: { ...p.tips, [id]: true } })),
    resetTips: () => setPrefs((p) => ({ ...p, tips: {}, onboarded: false })),
    sortFor: (key, fallback = 'new') => prefs.sorts[key] || fallback,
    setSort: (key, value) => setPrefs((p) => ({ ...p, sorts: { ...p.sorts, [key]: value } })),
  }), [prefs]);

  return <PrefsCtx.Provider value={api}>{children}</PrefsCtx.Provider>;
}

export const usePrefs = () => useContext(PrefsCtx);
