// fetchRetry.js — fetch із timeout (AbortController) і retry з експоненційним бекоффом (T3.4).
// Чистий модуль із dependency injection (fetchImpl/sleep) — тестується без мережі.
// Стрімінг тут НЕ реалізовано (свідомо; потребує живого прогону).

export class HttpError extends Error {
  constructor(status, message) {
    super(message || `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

// Транзієнтні статуси, які варто повторити (rate-limit / тимчасові збої сервера).
export const RETRYABLE_STATUSES = [408, 409, 425, 429, 500, 502, 503, 504];

/**
 * fetch із таймаутом і повторами. Повертає Response (його обробляє виклик).
 * @param {string} url
 * @param {object} [options]  стандартні опції fetch
 * @param {object} [cfg] { timeoutMs, retries, backoffMs, retryStatuses, fetchImpl, sleep, signal }
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, cfg = {}) {
  const {
    timeoutMs = 45000,
    retries = 2,
    backoffMs = 600,
    retryStatuses = RETRYABLE_STATUSES,
    fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    signal: externalSignal
  } = cfg;

  if (!fetchImpl) throw new Error('fetch недоступний у цьому середовищі (передай fetchImpl).');

  let attempt = 0;
  let lastErr;

  while (attempt <= retries) {
    const ctrl = new AbortController();
    const onExternalAbort = () => ctrl.abort();
    if (externalSignal) {
      if (externalSignal.aborted) ctrl.abort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);

      // Транзієнтний статус → повтор (якщо лишились спроби)
      if (retryStatuses.includes(res.status) && attempt < retries) {
        lastErr = new HttpError(res.status);
        await sleep(backoffMs * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);

      // Явне зовнішнє скасування — не повторюємо
      if (externalSignal && externalSignal.aborted) throw err;

      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffMs * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
