// Запуск модулей приложения в Node без телефона: Capacitor и IndexedDB подменяются заглушками в памяти.
import { register } from 'node:module';
import { fakeIndexedDB } from './fake-idb.mjs';

globalThis.__native = true;
globalThis.indexedDB = fakeIndexedDB;
register('./hooks.mjs', import.meta.url);
