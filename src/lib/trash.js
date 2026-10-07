// Правила корзины: удалённое хранится 30 дней, «Недавно удалённые» — за последнюю неделю.
export const TRASH_DAYS = 30;
export const RECENT_DAYS = 7;
export const DAY = 86400000;

export const daysLeft = (deletedAt, now = Date.now()) => Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * DAY - now) / DAY));

// Материалы, срок хранения которых в корзине истёк.
export const expiredItems = (items, now = Date.now()) => items.filter((i) => i.deletedAt && i.deletedAt < now - TRASH_DAYS * DAY);

export const recentlyDeleted = (items, now = Date.now()) =>
  items.filter((i) => i.deletedAt && i.deletedAt > now - RECENT_DAYS * DAY).sort((a, b) => b.deletedAt - a.deletedAt);
