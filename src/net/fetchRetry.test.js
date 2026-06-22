// fetchRetry.test.js — Тести fetchWithRetry (T3.4). Мережа мокається через fetchImpl.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry, HttpError } from './fetchRetry.js';

const noSleep = () => Promise.resolve();
const resp = (status) => ({ status, ok: status >= 200 && status < 300 });

// Лічильник викликів + сценарій відповідей/помилок
function mockFetch(steps) {
  let i = 0;
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    if (step instanceof Error) throw step;
    return resp(step);
  };
  fn.calls = calls;
  return fn;
}

test('успіх з першої спроби — один виклик', async () => {
  const f = mockFetch([200]);
  const r = await fetchWithRetry('u', {}, { fetchImpl: f, sleep: noSleep });
  assert.equal(r.status, 200);
  assert.equal(f.calls.length, 1);
});

test('повтор на 503, потім успіх', async () => {
  const f = mockFetch([503, 200]);
  const r = await fetchWithRetry('u', {}, { fetchImpl: f, sleep: noSleep, retries: 2 });
  assert.equal(r.status, 200);
  assert.equal(f.calls.length, 2);
});

test('повтор на мережевій помилці, потім успіх', async () => {
  const f = mockFetch([new Error('network down'), 200]);
  const r = await fetchWithRetry('u', {}, { fetchImpl: f, sleep: noSleep, retries: 2 });
  assert.equal(r.status, 200);
  assert.equal(f.calls.length, 2);
});

test('НЕ повторює на 400 (клієнтська помилка)', async () => {
  const f = mockFetch([400, 200]);
  const r = await fetchWithRetry('u', {}, { fetchImpl: f, sleep: noSleep, retries: 2 });
  assert.equal(r.status, 400);
  assert.equal(f.calls.length, 1);
});

test('429 повторюється', async () => {
  const f = mockFetch([429, 429, 200]);
  const r = await fetchWithRetry('u', {}, { fetchImpl: f, sleep: noSleep, retries: 3 });
  assert.equal(r.status, 200);
  assert.equal(f.calls.length, 3);
});

test('вичерпання спроб на 503 → повертає останній Response', async () => {
  const f = mockFetch([503, 503, 503]);
  const r = await fetchWithRetry('u', {}, { fetchImpl: f, sleep: noSleep, retries: 1 });
  // 2 спроби (0 + 1 повтор), обидві 503 → повертається останній 503
  assert.equal(r.status, 503);
  assert.equal(f.calls.length, 2);
});

test('вичерпання спроб на мережевій помилці → кидає', async () => {
  const f = mockFetch([new Error('boom'), new Error('boom')]);
  await assert.rejects(
    fetchWithRetry('u', {}, { fetchImpl: f, sleep: noSleep, retries: 1 }),
    /boom/
  );
  assert.equal(f.calls.length, 2);
});

test('таймаут перериває запит (abort) і кидає без зайвих спроб', async () => {
  // fetchImpl, що ніколи не резолвиться, поки не прийде abort через signal
  const hangingFetch = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(
    fetchWithRetry('u', {}, { fetchImpl: hangingFetch, timeoutMs: 20, retries: 0 }),
    /aborted/
  );
});

test('зовнішнє скасування не повторюється', async () => {
  const ctrl = new AbortController();
  const hangingFetch = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const p = fetchWithRetry('u', {}, { fetchImpl: hangingFetch, signal: ctrl.signal, retries: 3, sleep: noSleep });
  ctrl.abort();
  await assert.rejects(p, /aborted/);
});
