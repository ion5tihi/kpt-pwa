// usage.test.js — Тести обліку токенів.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyUsage, addUsage, totalTokens, estimateCostUSD, formatTokens, formatCostUSD } from './usage.js';

test('порожній акумулятор', () => {
  const u = emptyUsage();
  assert.equal(u.promptTokens, 0);
  assert.equal(u.calls, 0);
  assert.equal(totalTokens(u), 0);
});

test('addUsage накопичує глобально й по моделях', () => {
  const u = emptyUsage();
  addUsage(u, { model: 'gpt-4o-mini', promptTokens: 100, completionTokens: 50 });
  addUsage(u, { model: 'gpt-4o-mini', promptTokens: 200, completionTokens: 30 });
  addUsage(u, { model: 'gpt-4o', promptTokens: 10, completionTokens: 5 });
  assert.equal(u.calls, 3);
  assert.equal(u.promptTokens, 310);
  assert.equal(u.completionTokens, 85);
  assert.equal(totalTokens(u), 395);
  assert.equal(u.byModel['gpt-4o-mini'].calls, 2);
  assert.equal(u.byModel['gpt-4o-mini'].promptTokens, 300);
  assert.equal(u.byModel['gpt-4o'].completionTokens, 5);
});

test('addUsage ігнорує сміттєві/відсутні значення', () => {
  const u = emptyUsage();
  addUsage(u, { model: 'gpt-4o-mini' }); // без токенів
  addUsage(u, { model: 'gpt-4o-mini', promptTokens: -5, completionTokens: NaN });
  assert.equal(u.promptTokens, 0);
  assert.equal(u.calls, 2);
});

test('estimateCostUSD: відома модель рахується точно', () => {
  const u = emptyUsage();
  addUsage(u, { model: 'gpt-4o-mini', promptTokens: 1_000_000, completionTokens: 1_000_000 });
  const { usd, complete } = estimateCostUSD(u);
  assert.ok(complete);
  assert.ok(Math.abs(usd - (0.15 + 0.60)) < 1e-9, `usd=${usd}`);
});

test('estimateCostUSD: невідома модель → complete=false', () => {
  const u = emptyUsage();
  addUsage(u, { model: 'super-secret-model', promptTokens: 1000, completionTokens: 1000 });
  const { usd, complete } = estimateCostUSD(u);
  assert.equal(complete, false);
  assert.equal(usd, 0); // невідому не рахуємо
});

test('formatTokens', () => {
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(1000), '1k');
  assert.equal(formatTokens(12300), '12.3k');
});

test('formatCostUSD: дрібні суми — 4 знаки, з "+" коли є невідомі', () => {
  const u = emptyUsage();
  addUsage(u, { model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 1000 });
  assert.match(formatCostUSD(u), /^≈ \$0\.\d{4}$/);
  addUsage(u, { model: 'unknown-x', promptTokens: 100, completionTokens: 100 });
  assert.match(formatCostUSD(u), /\+$/);
});
