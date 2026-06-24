// inbox.js — Інбокс подій клініки (ROADMAP T5.3). Чистий модуль (без LLM/DOM).
// Між сесіями клініка підкидає стажеру події, що вимагають рішення:
//   • missed_session — активний пацієнт не зʼявився (попередження при помірному ризику відмови);
//   • urgent_intake  — терміновий новий пацієнт чекає на прийом (з бібліотеки шаблонів).
// Генерація — детермінована (зі стану кейсів + seed), наслідки — через case.applyMissedSession
// та звичайний потік прийому. LLM лише озвучує, рішення про динаміку — поза ним (SPEC принцип).

import { CASE_TEMPLATES, getTemplate } from './templates.js';

let _seq = 0;
const eid = () => `ce_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

export const INBOX_PARAMS = {
  // dropoutRisk (%) ≥ цього порога в активному кейсі → подія «пропуск сесії».
  followupDropoutRisk: 35,
  // Детерміновані дельти стану на реакцію стажера (між сесіями).
  missed: {
    outreach: { alliance: +6, dropoutRisk: -15 },  // проактивний контакт — добра практика
    wait:     { alliance: -8, dropoutRisk: +12 }    // пасивність — альянс слабшає
    // 'discharge' — закриває випадок (обробляється в case.applyMissedSession)
  }
};

/**
 * @typedef {Object} ClinicEvent
 * @property {string} id
 * @property {'missed_session'|'urgent_intake'} type
 * @property {string} title
 * @property {string} body
 * @property {string} [caseCode]      для missed_session — код кейса в caseload
 * @property {string} [templateId]    для urgent_intake — шаблон, з якого створити Case
 * @property {Array<{id:string,label:string,tone:string}>} options
 * @property {'pending'|'resolved'} status
 * @property {string} [resolution]    підсумок після вибору
 * @property {string} createdAt
 */

/** Чи потребує активний кейс уваги (помірний ризик відмови → ризик неявки). */
export function caseNeedsFollowup(kase, params = INBOX_PARAMS) {
  return !!kase && kase.status === 'active'
    && (kase.state?.dropoutRisk ?? 0) >= params.followupDropoutRisk;
}

/** Подія «пропуск сесії» для конкретного кейса. @returns {ClinicEvent} */
export function makeMissedSessionEvent(caseCode, kase) {
  const name = kase?.profile?.displayName || caseCode;
  return {
    id: eid(),
    type: 'missed_session',
    caseCode,
    title: `Пропуск сесії: ${name}`,
    body: `${name} не зʼявився на заплановану сесію і не попередив. Ризик випадання з терапії зростає. Як відреагуєте?`,
    options: [
      { id: 'outreach', label: 'Звʼязатися з пацієнтом', tone: 'primary' },
      { id: 'wait', label: 'Зачекати до наступного тижня', tone: 'ghost' },
      { id: 'discharge', label: 'Виписати за неявку', tone: 'danger' }
    ],
    status: 'pending',
    createdAt: new Date().toISOString()
  };
}

/** Подія «терміновий новий пацієнт» із заданого шаблону. @returns {ClinicEvent} */
export function makeUrgentIntakeEvent(template) {
  const t = typeof template === 'string' ? getTemplate(template) : template;
  if (!t) throw new Error(`Невідомий шаблон для термінового прийому: ${template}`);
  return {
    id: eid(),
    type: 'urgent_intake',
    templateId: t.id,
    title: `Терміновий пацієнт: ${t.title}`,
    body: `У клініку звернувся новий пацієнт, що потребує невідкладного прийому (${t.title}, складність ${t.difficulty}/5). Узяти випадок?`,
    options: [
      { id: 'accept', label: 'Прийняти зараз', tone: 'primary' },
      { id: 'defer', label: 'Перенаправити / відкласти', tone: 'ghost' }
    ],
    status: 'pending',
    createdAt: new Date().toISOString()
  };
}

/**
 * Чи є шаблон «терміновим» (висока гострота): ризик безпеки на вході, сценарна подія
 * або risk-параметр ≥2. Саме такі кейси доречно подавати як невідкладний прийом.
 */
export function isUrgentTemplate(t) {
  return !!t && (
    (t.constructorConfig?.risk ?? 0) >= 2 ||
    (t.scriptedEvents?.length || 0) > 0 ||
    (t.initialStatePreset?.suicideRisk ?? 0) >= 2
  );
}

/**
 * Детермінований вибір шаблону для термінового прийому: «гострий» кейс (isUrgentTemplate),
 * якого ще немає у caseload. Якщо всі вже використані — будь-який гострий; як остання
 * лінія — будь-який шаблон.
 * @param {number} seed
 * @param {string[]} [usedTemplateIds]
 * @returns {import('./templates.js').CaseTemplate|null}
 */
export function pickUrgentTemplate(seed, usedTemplateIds = []) {
  const used = new Set(usedTemplateIds);
  const urgent = CASE_TEMPLATES.filter(isUrgentTemplate);
  const pool = urgent.length ? urgent : CASE_TEMPLATES;
  if (!pool.length) return null;
  const fresh = pool.filter((t) => !used.has(t.id));
  const pick = fresh.length ? fresh : pool;
  const idx = (seed >>> 0) % pick.length;
  return pick[idx];
}

/** Чи є непрочитані (pending) події в інбоксі. */
export const hasPendingEvents = (inbox) =>
  Array.isArray(inbox) && inbox.some((e) => e && e.status === 'pending');

/** Кількість pending-подій (для бейджа). */
export const pendingCount = (inbox) =>
  Array.isArray(inbox) ? inbox.filter((e) => e && e.status === 'pending').length : 0;
