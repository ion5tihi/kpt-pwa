// scripted.js — Сценарні події (ScriptedEvent) для шаблонів кейсів. ROADMAP T5.2.
// Чистий модуль (без LLM/DOM). Дає АВТОРУ кейсу детерміновано «запланувати» подію на
// конкретну сесію N — напр. кризу безпеки, життєвий тригер або зрив — поверх стохастики рушія.
//
// Дві фази (ключ — `atSession` = «на/довкола сесії N»):
//   • safety_crisis — PRE-session: пацієнт ПРИХОДИТЬ на сесію N з ризиком ≥2. Стажер мусить
//     провести скринінг і відреагувати; якщо ні — наявний safety-override рушія карає (ENGINE §7).
//   • life_trigger / relapse — рушій форсує подію в кроці МІЖ сесіями, що рахується при записі
//     сесії N (override §6.1/§6.2; порядок rng не змінюється → детермінізм і форки збережено).
//
// ⚠️ КЛІНІЧНЕ ВРЯДУВАННЯ (SPEC §8, G.3): сценарії безпеки потребують валідації клініцистом.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const clamp01 = (x) => clamp(x, 0, 1);

/**
 * @typedef {Object} ScriptedEvent
 * @property {number} atSession      1-based індекс сесії, на якій спрацьовує
 * @property {'safety_crisis'|'life_trigger'|'relapse'} type
 * @property {number} [severity]     0..1 — для life_trigger/relapse (тяжкість тригера)
 * @property {2|3}    [riskLevel]    для safety_crisis: рівень ризику (за замовч. 2)
 * @property {string} [description]  наратив-сід для озвучення/UI
 * @property {string} [note]         нотатка клініциста
 */

/** Сценарні події, що спрацьовують на сесії `sessionIndex`. @returns {ScriptedEvent[]} */
export function getScriptedForSession(scriptedEvents = [], sessionIndex) {
  return (scriptedEvents || []).filter((e) => e && e.atSession === sessionIndex);
}

/**
 * PRE-session: підготувати стан, з яким пацієнт ЗАХОДИТЬ на сесію `sessionIndex`.
 * Наразі — safety_crisis: підняти suicideRisk до riskLevel (≥2) і підтягнути phq9, щоб
 * криза була клінічно когерентною. Чиста функція (вхідний стан не мутується).
 * @param {import('../engine/types').ClinicalState} state
 * @param {ScriptedEvent[]} scriptedEvents
 * @param {number} sessionIndex
 * @returns {{state: object, applied: ScriptedEvent[], riskFlag: number|null}}
 *          `riskFlag` — підказка для прихованої моделі LLM (щоб пацієнт це озвучив), або null.
 */
export function applyPreSessionScript(state, scriptedEvents = [], sessionIndex) {
  const applied = [];
  let riskFlag = null;
  const next = { ...state };
  for (const e of getScriptedForSession(scriptedEvents, sessionIndex)) {
    if (e.type === 'safety_crisis') {
      const level = clamp(e.riskLevel ?? 2, 2, 3);
      next.suicideRisk = Math.max(next.suicideRisk || 0, level);
      next.phq9 = clamp(Math.max(next.phq9 || 0, 18), 0, 27); // гостра криза рідко при низькому PHQ
      riskFlag = Math.max(riskFlag ?? 0, level);
      applied.push(e);
    }
  }
  return { state: next, applied, riskFlag };
}

/**
 * BETWEEN-session override для рушія: форсує life_trigger/relapse у кроці, що рахується
 * при записі сесії `sessionIndex`. Повертає поля контексту для stepBetweenSessions.
 * @param {ScriptedEvent[]} scriptedEvents
 * @param {number} sessionIndex
 * @returns {{forceTrigger?:boolean, forcedTriggerSeverity?:number, forceRelapse?:boolean}}
 */
export function scriptedContext(scriptedEvents = [], sessionIndex) {
  const ctx = {};
  for (const e of getScriptedForSession(scriptedEvents, sessionIndex)) {
    if (e.type === 'life_trigger') {
      ctx.forceTrigger = true;
      ctx.forcedTriggerSeverity = clamp01(e.severity ?? 0.7);
    } else if (e.type === 'relapse') {
      ctx.forceRelapse = true;
      // зрив без вираженого тригера малоймовірний — підсилюємо тригер, якщо заданий
      ctx.forceTrigger = true;
      ctx.forcedTriggerSeverity = clamp01(e.severity ?? 0.8);
    }
  }
  return ctx;
}

/** Чи має кейс заплановані сценарні події (для UI-бейджів). */
export const hasScriptedEvents = (scriptedEvents) => Array.isArray(scriptedEvents) && scriptedEvents.length > 0;
