import test from 'node:test';
import assert from 'node:assert/strict';
import { daysLeft, expiredItems, recentlyDeleted, TRASH_DAYS, DAY } from '../src/lib/trash.js';

const now = Date.UTC(2026, 9, 7, 12);

test('в корзине хранится 30 дней', () => {
  assert.equal(TRASH_DAYS, 30);
  assert.equal(daysLeft(now, now), 30);
  assert.equal(daysLeft(now - 29.5 * DAY, now), 1);
  assert.equal(daysLeft(now - 31 * DAY, now), 0);
});

test('автоудаление забирает только то, что пролежало больше 30 дней', () => {
  const items = [
    { id: 'live', deletedAt: null },
    { id: 'fresh', deletedAt: now - 2 * DAY },
    { id: 'edge', deletedAt: now - 30 * DAY + 1000 },
    { id: 'old', deletedAt: now - 31 * DAY },
  ];
  assert.deepEqual(expiredItems(items, now).map((i) => i.id), ['old']);
});

test('«Недавно удалённые» — за 7 дней, новые сверху', () => {
  const items = [
    { id: 'a', deletedAt: now - 1 * DAY },
    { id: 'b', deletedAt: now - 8 * DAY },
    { id: 'c', deletedAt: now - 1000 },
    { id: 'd', deletedAt: null },
  ];
  assert.deepEqual(recentlyDeleted(items, now).map((i) => i.id), ['c', 'a']);
});
