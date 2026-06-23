// usage.js — Облік витрати токенів LLM (чистий модуль, без LLM/DOM).
// Накопичує токени глобально та по випадках; рахує приблизну вартість.

// ⚠️ ПРИБЛИЗНІ тарифи (USD за 1 млн токенів, вхід/вихід). Ціни змінюються —
// це орієнтир, а не рахунок. Онови за потреби. Невідомі моделі → вартість «неповна».
export const MODEL_PRICES_USD_PER_MTOK = {
  'gpt-4o-mini':                 { in: 0.15, out: 0.60 },
  'gpt-4o':                      { in: 2.50, out: 10.00 },
  'gpt-4.1-mini':                { in: 0.40, out: 1.60 },
  'gpt-4.1':                     { in: 2.00, out: 8.00 },
  'claude-3-5-haiku-20241022':   { in: 0.80, out: 4.00 },
  'claude-3-5-sonnet-20241022':  { in: 3.00, out: 15.00 }
};

const n = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);

/** Порожній акумулятор. */
export function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, calls: 0, byModel: {} };
}

/**
 * Додати один виклик до акумулятора (мутує й повертає його).
 * @param {object} acc  акумулятор (emptyUsage())
 * @param {{model?:string, promptTokens?:number, completionTokens?:number}} call
 */
export function addUsage(acc, { model = 'unknown', promptTokens = 0, completionTokens = 0 } = {}) {
  const p = n(promptTokens), c = n(completionTokens);
  acc.promptTokens += p;
  acc.completionTokens += c;
  acc.calls += 1;
  const m = acc.byModel[model] || (acc.byModel[model] = { promptTokens: 0, completionTokens: 0, calls: 0 });
  m.promptTokens += p;
  m.completionTokens += c;
  m.calls += 1;
  return acc;
}

/** Усього токенів (вхід + вихід). */
export function totalTokens(acc) {
  return (acc?.promptTokens || 0) + (acc?.completionTokens || 0);
}

/**
 * Приблизна вартість у USD. complete=false, якщо траплялись моделі без тарифу.
 * @returns {{usd:number, complete:boolean}}
 */
export function estimateCostUSD(acc) {
  let usd = 0, complete = true;
  for (const [model, u] of Object.entries(acc?.byModel || {})) {
    const price = MODEL_PRICES_USD_PER_MTOK[model];
    if (!price) { complete = false; continue; }
    usd += (u.promptTokens / 1e6) * price.in + (u.completionTokens / 1e6) * price.out;
  }
  return { usd, complete };
}

/** Компактний підпис кількості токенів: 1234 → "1.2k". */
export function formatTokens(num) {
  const v = n(num);
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

/** Приблизна вартість текстом: "≈ $0.0123" або "≈ $0.01+" якщо є невідомі моделі. */
export function formatCostUSD(acc) {
  const { usd, complete } = estimateCostUSD(acc);
  const num = usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2);
  return `≈ $${num}${complete ? '' : '+'}`;
}
