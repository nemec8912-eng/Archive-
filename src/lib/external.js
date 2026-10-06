// Отметка «сейчас откроется системное окно» (выбор файла, камера, «Поделиться»).
// Пока оно открыто, приложение уходит в фон — это не повод сразу блокировать архив.
let mark = 0;
export const markExternal = () => { mark = Date.now(); };
export const externalRecently = (ms = 120000) => Date.now() - mark < ms;
export const clearExternal = () => { mark = 0; };

// Любой выбор файла (в том числе программный .click()) — системное окно.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (e.target?.matches?.('input[type=file]')) markExternal();
  }, true);
}
