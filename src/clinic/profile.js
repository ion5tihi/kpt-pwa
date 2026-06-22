// profile.js — Лонгітюдний профіль компетентності стажера (Фаза 4 / T4.1).
// Чистий модуль (без LLM/DOM): агрегує оцінки сесій з УСІХ випадків у TraineeProfile.
// Реалізує DOMAIN_MODEL TraineeProfile (+ похідні поля для дашборда T4.2).
// «Погляд супервізора на стажера в часі» — числа з реальних оцінок, не з ШІ.

import { CTSR_ITEM_KEYS } from './assessment.js';

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

// Людські назви пунктів CTS-R (для дашборда «що тренувати далі»).
export const CTSR_ITEM_LABELS = {
  agenda: 'Порядок денний', feedback: 'Зворотний зв’язок', collaboration: 'Співпраця',
  pacing: 'Темп і час', interpersonal: 'Міжособистісна ефективність',
  guidedDiscovery: 'Скероване відкриття', conceptualization: 'Концептуалізація',
  keyCognitions: 'Ключові когніції', focusEmotion: 'Робота з емоціями',
  focusBehavior: 'Робота з поведінкою', techniques: 'Техніки змін', homework: 'Домашнє завдання'
};

export const MITI_GLOBAL_LABELS = {
  cultivatingChangeTalk: 'Плекання мови змін', softeningSustainTalk: 'Пом’якшення статус-кво',
  partnership: 'Партнерство', empathy: 'Емпатія'
};

const CASE_STATUSES = ['active', 'discharged', 'dropped_out', 'crisis'];

// Цілі MI (з ENGINE §2): reflection:question ≥2, складні рефлексії ≥50%, глобали ≥3.5/5.
const MI_TARGET = { reflectionRatio: 2, complexPct: 0.5, miti: 3.5, ctsrItem: 3 };

/**
 * Побудувати профіль стажера з набору випадків.
 * @param {Object<string,object>|Array<object>} cases  мапа code→Case або масив Case
 * @param {object} [opts] { id?, weakestN? }
 * @returns {object} TraineeProfile (+ ctsrItemAverages, mitiAverages, recommendations)
 */
export function buildTraineeProfile(cases, opts = {}) {
  const caseList = Array.isArray(cases) ? cases : Object.values(cases || {});

  // Усі сесії з оцінкою — у хронологічному порядку (дата, потім індекс).
  const sessions = [];
  for (const k of caseList) {
    for (const s of (k.sessions || [])) {
      if (s && s.assessment) sessions.push(s);
    }
  }
  sessions.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.index || 0) - (b.index || 0));
  const assessments = sessions.map((s) => s.assessment);
  const ctsrTotals = assessments.map((a) => a.ctsrTotal ?? 0);

  // Середні по кожному пункту CTS-R (0–6)
  const ctsrItemAverages = {};
  for (const item of CTSR_ITEM_KEYS) {
    ctsrItemAverages[item] = round2(mean(assessments.map((a) => (a.ctsr && a.ctsr[item]) ?? 0)));
  }
  // Хронічно слабкі пункти (за зростанням середнього), bottom-N
  const weakestCtsrItems = assessments.length
    ? [...CTSR_ITEM_KEYS].sort((x, y) => ctsrItemAverages[x] - ctsrItemAverages[y]).slice(0, opts.weakestN ?? 3)
    : [];

  // Тренди (хронологічні, одна точка = одна сесія)
  const ctsrTrend = ctsrTotals.slice();
  const reflectionRatioTrend = assessments.map((a) => round2(a.miti?.reflectionToQuestion ?? 0));
  const complexReflectionTrend = assessments.map((a) => round2(a.miti?.complexReflectionPct ?? 0));

  // Середні MITI-глобали (1–5)
  const mitiAverages = {};
  for (const m of Object.keys(MITI_GLOBAL_LABELS)) {
    mitiAverages[m] = round2(mean(assessments.map((a) => a.miti?.[m] ?? 0)));
  }

  // Підсумки випадків за статусом
  const outcomesByStatus = Object.fromEntries(CASE_STATUSES.map((s) => [s, 0]));
  for (const k of caseList) if (k.status in outcomesByStatus) outcomesByStatus[k.status]++;

  // Реакція на сигнали безпеки
  const faced = assessments.filter((a) => a.events?.safetyFlagPresent).length;
  const handled = assessments.filter((a) => a.events?.safetyFlagPresent && a.events?.safetyHandled).length;
  const missedCrises = caseList.reduce(
    (n, k) => n + (k.events || []).filter((e) => e.type === 'crisis').length, 0);

  return {
    id: opts.id || 'trainee',
    sessionsCompleted: sessions.length,
    casesCompleted: caseList.filter((k) => k.status && k.status !== 'active').length,
    avgCtsr: round1(mean(ctsrTotals)),            // /72
    ctsrTrend,
    reflectionRatioTrend,
    complexReflectionTrend,
    ctsrItemAverages,
    mitiAverages,
    weakestCtsrItems,
    outcomesByStatus,
    safetyResponses: { faced, handled, missedCrises },
    recommendations: buildRecommendations({ assessments, ctsrItemAverages, mitiAverages, reflectionRatioTrend, complexReflectionTrend, weakestCtsrItems })
  };
}

/** Прості actionable-рекомендації «що тренувати далі» (для T4.2). */
function buildRecommendations({ assessments, ctsrItemAverages, mitiAverages, reflectionRatioTrend, complexReflectionTrend, weakestCtsrItems }) {
  if (!assessments.length) return [];
  const recs = [];

  // 1) Найслабші пункти CTS-R, що нижче порогу «адекватно»
  for (const item of weakestCtsrItems) {
    if (ctsrItemAverages[item] < MI_TARGET.ctsrItem) {
      recs.push({ kind: 'ctsr', area: CTSR_ITEM_LABELS[item] || item,
        detail: `Середній бал ${ctsrItemAverages[item]}/6 — нижче адекватного рівня.` });
    }
  }
  // 2) MITI-глобали нижче цілі
  for (const [m, label] of Object.entries(MITI_GLOBAL_LABELS)) {
    if (mitiAverages[m] < MI_TARGET.miti) {
      recs.push({ kind: 'miti', area: label, detail: `Середнє ${mitiAverages[m]}/5 — ціль ≥${MI_TARGET.miti}.` });
    }
  }
  // 3) Співвідношення рефлексій до запитань
  const avgRatio = round2(mean(reflectionRatioTrend));
  if (avgRatio < MI_TARGET.reflectionRatio) {
    recs.push({ kind: 'mi', area: 'Рефлексії проти запитань',
      detail: `Середнє ${avgRatio}:1 — ціль ≥${MI_TARGET.reflectionRatio}:1. Менше запитань, більше рефлексій.` });
  }
  // 4) Частка складних рефлексій
  const avgComplex = round2(mean(complexReflectionTrend));
  if (avgComplex < MI_TARGET.complexPct) {
    recs.push({ kind: 'mi', area: 'Складні рефлексії',
      detail: `Середнє ${Math.round(avgComplex * 100)}% — ціль ≥${MI_TARGET.complexPct * 100}%.` });
  }

  return recs.slice(0, 5); // не перевантажуємо стажера
}

/**
 * Звіт по одному завершеному (чи активному) випадку — для T4.3.
 * @param {object} kase  Case
 * @returns {object} { status, summary, sessions, avgCtsr, ctsrSeries, keyMoments, eventsCount, finalState }
 */
export function buildCaseReport(kase) {
  if (!kase) return null;
  const withAsmt = (kase.sessions || []).filter((s) => s.assessment);
  const ctsrSeries = withAsmt.map((s) => s.assessment.ctsrTotal ?? 0);
  const eventsByType = {};
  for (const e of (kase.events || [])) eventsByType[e.type] = (eventsByType[e.type] || 0) + 1;

  return {
    status: kase.status,
    summary: kase.outcome?.summary || (kase.status === 'active' ? 'Випадок триває.' : ''),
    sessions: (kase.sessions || []).length,
    avgCtsr: round1(mean(ctsrSeries)),
    ctsrSeries,
    keyMoments: kase.outcome?.keyMoments || (kase.events || [])
      .filter((e) => e.type === 'relapse' || e.type === 'crisis')
      .map((e) => ({ sessionIndex: e.afterSessionIndex, note: e.type === 'crisis' ? 'Криза безпеки' : 'Зрив' })),
    eventsByType,
    finalState: kase.state || null
  };
}
