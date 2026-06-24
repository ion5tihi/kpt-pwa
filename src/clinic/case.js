// case.js — Життєвий цикл випадку (Case): прийом → сесії → результат.
// Оркеструє симуляційний рушій: кожна сесія стартує з ПОТОЧНОГО стану пацієнта,
// після оцінки сесії рушій рахує наступний стан. Графік малює РЕАЛЬНІ числа.
// Реалізує DOMAIN_MODEL.md (Case/Session/Outcome) + ROADMAP T1.1–T1.4.

import { stepBetweenSessions } from '../engine/engine.js';
import { ENGINE_PARAMS } from '../engine/params.js';
import { scriptedContext, applyPreSessionScript } from './scripted.js';

const CURRENT_SCHEMA = 1;
const clone = (x) => structuredClone(x);
const uid = () => 'c_' + Math.random().toString(36).slice(2, 10);

/**
 * Створити випадок із даних прийому.
 * @param {object} args
 * @param {import('../engine/types').PatientProfile} args.profile
 * @param {import('../engine/types').ClinicalState} args.initialState
 * @param {number} [args.seed]
 * @param {import('./scripted.js').ScriptedEvent[]} [args.scriptedEvents]  сценарні події (T5.2)
 */
export function createCase({ profile, initialState, seed = 12345, scriptedEvents = [] }) {
  return {
    id: uid(),
    schemaVersion: CURRENT_SCHEMA,
    profile,
    state: clone(initialState),        // ПОТОЧНИЙ стан (стартова точка наступної сесії)
    initialState: clone(initialState), // S₀ на прийомі
    sessions: [],
    events: [],
    scriptedEvents: clone(scriptedEvents || []), // авторські заплановані події (T5.2)
    status: 'active',
    outcome: null,
    seed,
    _stableStreak: 0                   // лічильник стабільних сесій для виписки
  };
}

/**
 * Початок сесії `sessionIndex` (PRE-session). Застосовує сценарні події, що мають
 * настати ДО/ПІД ЧАС цієї сесії (напр. пацієнт приходить у кризі). Мутує `kase.state`.
 * @param {object} kase
 * @param {number} sessionIndex  1-based номер сесії, що ось-ось почнеться
 * @returns {{applied: import('./scripted.js').ScriptedEvent[], riskFlag: number|null}}
 *          `riskFlag` — підказка для прихованої моделі LLM, щоб пацієнт озвучив ризик.
 */
export function beginSession(kase, sessionIndex) {
  const { state, applied, riskFlag } = applyPreSessionScript(kase.state, kase.scriptedEvents || [], sessionIndex);
  kase.state = state;
  return { applied, riskFlag };
}

const isComorbidGAD = (profile) => profile?.disorderType === 'dual-gtr';

/**
 * Записати результат щойно завершеної сесії та просунути випадок у часі.
 * @param {object} kase  випадок (мутується)
 * @param {import('../engine/types').Assessment} assessment  оцінка сесії
 * @param {object} [opts] { daysBetweenSessions?, behavioralActivation? }
 * @returns {{session, result}}
 */
export function recordSessionOutcome(kase, assessment, opts = {}, params = ENGINE_PARAMS) {
  if (kase.status !== 'active') {
    throw new Error(`Випадок закрито (статус: ${kase.status}). Нові сесії неможливі.`);
  }

  const sessionIndex = kase.sessions.length + 1;
  const stateAtStart = clone(kase.state);

  const result = stepBetweenSessions({
    state: kase.state,
    initialState: kase.initialState,
    assessment,
    context: {
      sessionIndex,
      daysBetweenSessions: opts.daysBetweenSessions ?? 7,
      comorbidityGAD: isComorbidGAD(kase.profile),
      behavioralActivation: !!opts.behavioralActivation,
      seed: kase.seed,
      ...scriptedContext(kase.scriptedEvents || [], sessionIndex) // T5.2: форсовані події між сесіями
    }
  }, params);

  const session = {
    id: 's_' + sessionIndex,
    caseId: kase.id,
    index: sessionIndex,
    date: opts.date ?? new Date().toISOString().slice(0, 10),
    stateAtStart,          // снапшот для графіка/відтворюваності
    assessment,
    events: result.events,
    durationTurns: assessment.durationTurns ?? 0
  };
  kase.sessions.push(session);

  // Просування стану
  kase.state = result.nextState;
  for (const e of result.events) {
    kase.events.push({ ...e, caseId: kase.id, afterSessionIndex: sessionIndex });
  }

  // Перехід статусу
  if (result.status === 'crisis') {
    closeCase(kase, 'crisis', sessionIndex, 'Криза безпеки: пропущено сигнал ризику.');
  } else if (result.status === 'dropped_out') {
    closeCase(kase, 'dropped_out', sessionIndex, 'Пацієнт припинив лікування (низький альянс / високий опір).');
  } else {
    // Логіка виписки за стабільним стріком (ENGINE §8)
    kase._stableStreak = result.dischargeEligible ? kase._stableStreak + 1 : 0;
    if (kase._stableStreak >= params.discharge.stableStreak) {
      closeCase(kase, 'discharged', sessionIndex, 'Стабільна ремісія: критерії виписки дотримано.');
    }
  }

  return { session, result };
}

function closeCase(kase, status, atSession, summary) {
  kase.status = status;
  kase.outcome = {
    status,
    closedAtSession: atSession,
    summary,
    trajectory: getTrajectory(kase),
    keyMoments: kase.events
      .filter((e) => e.type === 'relapse' || e.type === 'crisis')
      .map((e) => ({ sessionIndex: e.afterSessionIndex, note: e.type === 'crisis' ? 'Криза безпеки' : 'Зрив' }))
  };
}

/**
 * Траєкторія для графіка: реальні снапшоти стану по сесіях + поточний стан.
 * @returns {Array<object>} точки з ключовими шкалами
 */
export function getTrajectory(kase) {
  const pick = (s, idx) => ({
    sessionIndex: idx,
    pacs: s.pacs, gad7: s.gad7, phq9: s.phq9, soberDays: s.soberDays, sleep: s.sleep,
    alliance: s.alliance, readiness: s.readiness, relapseRisk: s.relapseRisk
  });
  // стартова точка кожної сесії + фінальний (поточний) стан як остання точка
  const points = kase.sessions.map((sess, i) => pick(sess.stateAtStart, i + 1));
  points.push(pick(kase.state, kase.sessions.length + 1));
  return points;
}

/** Чи доступний для пацієнта повторний прийом (випадок ще активний). */
export const canContinue = (kase) => kase.status === 'active';

/**
 * Deliberate practice (T5.4): «відмотати» випадок до початку сесії `atSession`
 * і відкрити форк для повторної спроби. Той самий `seed` → ті самі життєві події,
 * тож різниця в траєкторії = різниця у ВАШІЙ роботі, а не у випадковості.
 * @param {object} kase  оригінальний Case
 * @param {number} atSession  1-based індекс сесії, яку перепроходимо (1 = з прийому)
 * @returns {object} новий Case (status 'active'), позначений forkedFrom/forkedAtSession
 */
export function forkCaseFromSession(kase, atSession) {
  const n = (kase.sessions || []).length;
  if (!Number.isInteger(atSession) || atSession < 1 || atSession > n) {
    throw new Error(`Немає сесії №${atSession} для перепроходження (усього сесій: ${n}).`);
  }
  // Стан на початок цієї сесії: для 1-ї — S₀, інакше — снапшот stateAtStart.
  const startState = atSession === 1 ? kase.initialState : kase.sessions[atSession - 1].stateAtStart;

  return {
    id: uid(),
    schemaVersion: CURRENT_SCHEMA,
    profile: clone(kase.profile),
    state: clone(startState),
    initialState: clone(kase.initialState),
    sessions: clone(kase.sessions.slice(0, atSession - 1)), // сесії ДО точки повтору
    events: clone((kase.events || []).filter((e) => e.afterSessionIndex < atSession)),
    scriptedEvents: clone(kase.scriptedEvents || []),       // ті самі сценарні події (T5.2)
    status: 'active',
    outcome: null,
    seed: kase.seed,                 // той самий жереб → ізолюємо ефект терапевта
    _stableStreak: 0,
    forkedFrom: kase.id,
    forkedAtSession: atSession
  };
}
