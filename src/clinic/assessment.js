// assessment.js — Міст: структурована оцінка сесії → Assessment для рушія.
// Чистий модуль (без LLM/DOM). Нормалізує СИРИЙ вхід (напр. JSON від супервізора-LLM)
// у валідний Assessment за DOMAIN_MODEL.md: ctsr (12 пунктів 0–6), miti, events.
// Тут НЕ обчислюються subScores — це робить рушій (ENGINE §3).

// Порядок = 12 пунктів CTS-R із промпта супервізії (api.js getEvalPrompt).
export const CTSR_ITEM_KEYS = [
  'agenda', 'feedback', 'collaboration', 'pacing', 'interpersonal',
  'guidedDiscovery', 'conceptualization', 'keyCognitions',
  'focusEmotion', 'focusBehavior', 'techniques', 'homework'
];

// MITI-глобали за шкалою 1–5 (reflectionToQuestion і complexReflectionPct окремо).
export const MITI_GLOBAL_KEYS = [
  'cultivatingChangeTalk', 'softeningSustainTalk', 'partnership', 'empathy'
];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x, fallback) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

// Нейтральні дефолти, якщо модель не дала поле (щоб рушій не падав і не штрафував зайве).
const DEFAULT_CTSR = 3;       // «адекватно» (середина 0–6)
const DEFAULT_MITI = 3;       // середина 1–5
const DEFAULT_RATIO = 1;      // 1:1 рефлексії:запитання
const DEFAULT_COMPLEX = 0.25; // 25% складних рефлексій

/**
 * Нормалізувати сирий об'єкт оцінки у валідний Assessment для рушія.
 * Толерантний до пропусків/сміття: клемпить діапазони, підставляє нейтральні дефолти.
 * @param {object} [raw] сирий вхід (напр. розпарсений JSON від LLM-супервізора)
 * @returns {import('../engine/types').Assessment}
 */
export function buildAssessment(raw = {}) {
  const rc = (raw && raw.ctsr) || {};
  const ctsr = {};
  for (const k of CTSR_ITEM_KEYS) {
    ctsr[k] = clamp(Math.round(num(rc[k], DEFAULT_CTSR)), 0, 6);
  }
  const ctsrTotal = CTSR_ITEM_KEYS.reduce((s, k) => s + ctsr[k], 0); // /72

  const rm = (raw && raw.miti) || {};
  const miti = {};
  for (const k of MITI_GLOBAL_KEYS) {
    miti[k] = clamp(num(rm[k], DEFAULT_MITI), 1, 5);
  }
  miti.reflectionToQuestion = Math.max(0, num(rm.reflectionToQuestion, DEFAULT_RATIO));
  miti.complexReflectionPct = clamp(num(rm.complexReflectionPct, DEFAULT_COMPLEX), 0, 1);

  const re = (raw && raw.events) || {};
  const events = {
    safetyFlagPresent: !!re.safetyFlagPresent,
    safetyHandled: !!re.safetyHandled,
    homeworkAssigned: !!re.homeworkAssigned,
    ruptures: Math.max(0, Math.round(num(re.ruptures, 0)))
  };

  return {
    ctsr,
    ctsrTotal,
    miti,
    events,
    narrative: typeof raw.narrative === 'string' ? raw.narrative : '',
    strengths: Array.isArray(raw.strengths) ? raw.strengths.slice() : [],
    growthAreas: Array.isArray(raw.growthAreas) ? raw.growthAreas.slice() : [],
    durationTurns: Math.max(0, Math.round(num(raw.durationTurns, 0)))
  };
}

/**
 * Опис JSON-контракту для промпта супервізора (єдине джерело правди контракту).
 * Тримаємо тут, щоб api.js і buildAssessment не розходились.
 */
export function assessmentSchemaHint() {
  return JSON.stringify({
    ctsr: CTSR_ITEM_KEYS.reduce((o, k) => ((o[k] = '0–6'), o), {}),
    miti: {
      cultivatingChangeTalk: '1–5', softeningSustainTalk: '1–5',
      partnership: '1–5', empathy: '1–5',
      reflectionToQuestion: 'число ≥0 (співвідношення рефлексій до запитань)',
      complexReflectionPct: '0–1 (частка складних рефлексій)'
    },
    events: {
      safetyFlagPresent: 'true/false — чи були сигнали ризику безпеки',
      safetyHandled: 'true/false — чи відреагував терапевт на ризик',
      homeworkAssigned: 'true/false — чи призначено домашнє завдання',
      ruptures: 'ціле ≥0 — кількість MI-непослідовних ходів (конфронтація, поради без дозволу)'
    }
  }, null, 2);
}

/**
 * Строга JSON-схема для OpenAI Structured Outputs (response_format json_schema, strict).
 * БЕЗ minimum/maximum — strict-режим їх не підтримує; діапазони доклемповує buildAssessment.
 * @returns {object} json_schema-сумісний об'єкт
 */
export function assessmentJsonSchema() {
  const ctsrProps = {};
  for (const k of CTSR_ITEM_KEYS) ctsrProps[k] = { type: 'integer' };
  const mitiProps = {
    cultivatingChangeTalk: { type: 'integer' },
    softeningSustainTalk: { type: 'integer' },
    partnership: { type: 'integer' },
    empathy: { type: 'integer' },
    reflectionToQuestion: { type: 'number' },
    complexReflectionPct: { type: 'number' }
  };
  const eventProps = {
    safetyFlagPresent: { type: 'boolean' },
    safetyHandled: { type: 'boolean' },
    homeworkAssigned: { type: 'boolean' },
    ruptures: { type: 'integer' }
  };
  const obj = (props) => ({ type: 'object', additionalProperties: false, properties: props, required: Object.keys(props) });
  return obj({ ctsr: obj(ctsrProps), miti: obj(mitiProps), events: obj(eventProps) });
}
