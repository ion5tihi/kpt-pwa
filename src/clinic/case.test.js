// case.test.js — Тести життєвого циклу випадку (Фаза 1).
// Запуск: node --test src/clinic/case.test.js  (або npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCase, recordSessionOutcome, getTrajectory, canContinue, forkCaseFromSession } from './case.js';
import { ENGINE_PARAMS } from '../engine/params.js';

// Параметри без стохастики — для детермінованих тестів логіки статусів.
const NO_STOCHASTIC = (() => {
  const p = structuredClone(ENGINE_PARAMS);
  p.dropout.b0 = -100;   // відмова практично неможлива
  p.relapse.b0 = -100;   // зрив практично неможливий
  p.trigger.pBase = 0;   // без тригерів
  return p;
})();

function makeState(over = {}) {
  return {
    pacs: 20, gad7: 12, phq9: 14, soberDays: 14, sleep: 5,
    readiness: 35, alliance: 40, insight: 30, selfEfficacy: 30, resistance: 55,
    relapseRisk: 0, dropoutRisk: 0, suicideRisk: 0, homeworkAdherence: 0.3,
    coreBelief: '...', hiddenFear: '...', resistanceMechanism: 'intellectualisation', primaryTrigger: '...',
    ...over
  };
}
function makeAssessment(over = {}) {
  const ctsr = { agenda: 3, feedback: 3, collaboration: 3, pacing: 3, interpersonal: 3, guidedDiscovery: 3, conceptualization: 3, keyCognitions: 3, focusEmotion: 3, focusBehavior: 3, techniques: 3, homework: 3, ...(over.ctsr || {}) };
  const miti = { cultivatingChangeTalk: 3, softeningSustainTalk: 3, partnership: 3, empathy: 3, reflectionToQuestion: 1, complexReflectionPct: 0.25, ...(over.miti || {}) };
  const events = { safetyFlagPresent: false, safetyHandled: false, homeworkAssigned: true, ruptures: 0, ...(over.events || {}) };
  return { ctsr, miti, events, ctsrTotal: 36, narrative: '', strengths: [], growthAreas: [], durationTurns: 8 };
}
const profile = { id: 'p1', displayName: 'Тест', disorderType: 'alko', treatmentStage: 'рання реабілітація', presentingComplaint: '', createdAt: '2026-01-01' };
const goodA = () => makeAssessment({ ctsr: { feedback: 5, collaboration: 5, interpersonal: 5, guidedDiscovery: 4, keyCognitions: 4, techniques: 4 }, miti: { cultivatingChangeTalk: 4, softeningSustainTalk: 4, partnership: 4, empathy: 4, reflectionToQuestion: 2, complexReflectionPct: 0.5 } });

// --- T1.1 / T1.2 Безперервність ---------------------------------------------
test('сесія стартує з поточного стану; рушій просуває стан', () => {
  const k = createCase({ profile, initialState: makeState(), seed: 7 });
  const before = structuredClone(k.state);
  const { session } = recordSessionOutcome(k, goodA());

  assert.deepStrictEqual(session.stateAtStart, before, 'снапшот = стан до сесії');
  assert.notDeepStrictEqual(k.state, before, 'стан змінився після сесії');
  assert.equal(k.sessions.length, 1);
  assert.equal(session.index, 1);
});

test('кілька сесій: кожна продовжує попередню (безперервність)', () => {
  const k = createCase({ profile, initialState: makeState(), seed: 7 });
  recordSessionOutcome(k, goodA(), {}, NO_STOCHASTIC);
  const afterFirst = structuredClone(k.state);
  const { session } = recordSessionOutcome(k, goodA(), {}, NO_STOCHASTIC);
  assert.deepStrictEqual(session.stateAtStart, afterFirst, 'друга сесія стартує там, де скінчилась перша');
  assert.equal(k.sessions.length, 2);
});

// --- T1.4 Траєкторія для графіка (реальні числа) ----------------------------
test('getTrajectory дає точку на сесію + поточну', () => {
  const k = createCase({ profile, initialState: makeState(), seed: 7 });
  recordSessionOutcome(k, goodA(), {}, NO_STOCHASTIC);
  recordSessionOutcome(k, goodA(), {}, NO_STOCHASTIC);
  const t = getTrajectory(k);
  assert.equal(t.length, 3); // 2 старти сесій + поточний стан
  assert.equal(t[0].sessionIndex, 1);
  for (const p of t) assert.ok(typeof p.pacs === 'number' && typeof p.readiness === 'number');
});

// --- Статуси: криза закриває випадок -----------------------------------------
test('пропущена криза безпеки закриває випадок зі статусом crisis', () => {
  const k = createCase({ profile, initialState: makeState({ suicideRisk: 3 }), seed: 7 });
  recordSessionOutcome(k, makeAssessment({ events: { safetyHandled: false } }));
  assert.equal(k.status, 'crisis');
  assert.ok(k.outcome);
  assert.equal(canContinue(k), false);
  assert.throws(() => recordSessionOutcome(k, goodA()), /закрито/);
});

// --- Статуси: виписка за стабільним стріком ----------------------------------
test('стабільний сильний пацієнт зрештою виписується', () => {
  const strong = makeState({ pacs: 3, gad7: 2, phq9: 2, soberDays: 120, readiness: 95, alliance: 90, resistance: 10, selfEfficacy: 90 });
  const k = createCase({ profile, initialState: strong, seed: 7 });
  let guard = 0;
  while (k.status === 'active' && guard++ < 10) {
    recordSessionOutcome(k, goodA(), {}, NO_STOCHASTIC);
  }
  assert.equal(k.status, 'discharged', `status=${k.status} після ${k.sessions.length} сесій`);
  assert.ok(k.sessions.length >= 3, 'виписка не раніше за стабільний стрік');
});

// --- Детермінізм на рівні випадку --------------------------------------------
test('однаковий seed → ідентична траєкторія курсу', () => {
  const run = () => {
    const k = createCase({ profile, initialState: makeState(), seed: 42 });
    for (let i = 0; i < 4 && k.status === 'active'; i++) recordSessionOutcome(k, goodA(), { date: '2026-01-0' + (i + 1) });
    return getTrajectory(k);
  };
  assert.deepStrictEqual(run(), run());
});

// --- T5.4 Deliberate practice (форк) -----------------------------------------
function makeCourse() {
  const k = createCase({ profile, initialState: makeState(), seed: 42 });
  recordSessionOutcome(k, goodA(), { date: '2026-01-01' }); // сесія 1
  recordSessionOutcome(k, goodA(), { date: '2026-01-08' }); // сесія 2
  return k;
}

test('форк із сесії 2: стан = stateAtStart сесії 2, історія обрізана, статус active', () => {
  const k = makeCourse();
  const f = forkCaseFromSession(k, 2);
  assert.deepStrictEqual(f.state, k.sessions[1].stateAtStart, 'стан = початок сесії 2');
  assert.equal(f.sessions.length, 1, 'лишилась лише сесія 1');
  assert.equal(f.status, 'active');
  assert.equal(f.seed, k.seed, 'той самий seed');
  assert.equal(f.forkedFrom, k.id);
  assert.equal(f.forkedAtSession, 2);
  assert.notEqual(f.id, k.id);
});

test('форк із сесії 1 стартує з initialState', () => {
  const f = forkCaseFromSession(makeCourse(), 1);
  assert.deepStrictEqual(f.state, makeState());
  assert.equal(f.sessions.length, 0);
});

test('поза діапазоном → помилка', () => {
  const k = makeCourse();
  assert.throws(() => forkCaseFromSession(k, 0));
  assert.throws(() => forkCaseFromSession(k, 5));
});

test('форк незалежний: зміни у форку не торкаються оригіналу', () => {
  const k = makeCourse();
  const f = forkCaseFromSession(k, 2);
  recordSessionOutcome(f, goodA(), { date: '2026-01-09' });
  assert.equal(k.sessions.length, 2, 'оригінал не змінився');
});

test('той самий seed+оцінка відтворює результат сесії; краща оцінка → кращий стан', () => {
  const k = makeCourse();
  // Перепроходимо сесію 2 ТІЄЮ САМОЮ оцінкою → той самий результат, що в оригіналі
  const same = forkCaseFromSession(k, 2);
  recordSessionOutcome(same, goodA(), { date: '2026-01-08' });
  assert.deepStrictEqual(same.state, k.state, 'однакова оцінка+seed → однаковий стан');

  // Перепроходимо слабкою оцінкою → альянс нижчий, ніж за goodA
  const worse = forkCaseFromSession(k, 2);
  const weakA = makeAssessment({ ctsr: { feedback: 1, collaboration: 1, interpersonal: 1 }, miti: { partnership: 1, empathy: 1 }, events: { ruptures: 2, homeworkAssigned: false } });
  recordSessionOutcome(worse, weakA, { date: '2026-01-08' });
  assert.ok(worse.state.alliance < same.state.alliance, 'гірша робота → нижчий альянс');
});
