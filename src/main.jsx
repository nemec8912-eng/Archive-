import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { initNative } from './native.js';
import { migrateBlobsToFiles } from './lib/db.js';

initNative();
// В приложении для телефона файлы из базы прошлых версий переносятся в папку приложения (в фоне).
migrateBlobsToFiles().catch(() => {});
createRoot(document.getElementById('root')).render(<App />);

// Офлайн-режим и установка на экран «Домой» (iPhone и Android). В установленном приложении не нужен.
if ('serviceWorker' in navigator && import.meta.env.PROD && !window.ArchiveNative) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
