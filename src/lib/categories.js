// Утверждённые категории (ТЗ, п. 4 и 13). Список не расширять без согласования.
export const CATEGORIES = [
  { type: 'photo', title: 'Фото', icon: 'image' },
  { type: 'video', title: 'Видео', icon: 'video' },
  { type: 'screenshot', title: 'Скриншоты', icon: 'phone' },
  { type: 'chat', title: 'Переписки', icon: 'chat' },
  { type: 'voice', title: 'Голосовые', icon: 'mic' },
  { type: 'note', title: 'Заметки', icon: 'note' },
];

export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.type, c]));

export const VISUAL = new Set(['photo', 'video', 'screenshot']);

export const DEFAULT_FOLDERS = ['Личное', 'Фото', 'Видео', 'Скриншоты', 'Переписки', 'Голосовые', 'Заметки'];
