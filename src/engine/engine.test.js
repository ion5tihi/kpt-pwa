// engine.test.js — Тести симуляційного рушія (ENGINE.md §11).
// Запуск: npm test   (або: node --test src/engine/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSubScores, updateHidden, updateObservable, stepBetweenSessions,
  normCtsr, normMiti, normRatio, normPct, clamp01, sigmoid
} from './engine.js';

// --- Фабрики тестових даних -------------------------------------------------
function makeState(over = {}) {
  return {
    pacs: 20, gad7: 12, phq9: 14, soberDays: 14, sleep: 5,
    readiness: 35, alliance: 40, insight: 30, selfEfficacy: 30, resistance: 55,
    relapseRisk: 0, dropoutRisk: 0, suicideRisk: 0, homeworkAdherence: 0.3,
    coreBelief: 'без алкоголю не впораюся', hiddenFear: 'самотність',
    resistanceMechanism: 'intellectualisation', primaryTrigger: 'конфлікт з дружиною',
    ...over
  };
}

function makeAssessment(over = {}) {
  const ctsr = {
    agenda: 3, feedback: 3, collaboration: 3, pacing: 3, interpersonal: 3,
    guidedDiscovery: 3, conceptualization: 3, keyCognitions: 3,
    focusEmotion: 3, focusBehavior: 3, techniques: 3, homework: 3,
    ...(over.ctsr || {})
  };
  const miti = {
    cultivatingChangeTalk: 3, softeningSustainTalk: 3, partnership: 3, empathy: 3,
    reflectionToQuestion: 1, complexReflectionPct: 0.25, ...(over.miti || {}) // 0.25 = рівно нейтрально (ціль 0.5)
  };
  const events = { safetyFlagPresent: false, safetyHandled: false, homeworkAssigned: true, ruptures: 0, ...(over.events || {}) };
  return { ctsr, miti, events, ctsrTotal: 36, narrative: '', strengths: [], growthAreas: [] };
}

const ctx = (over = {}) => ({ sessionIndex: 1, daysBetweenSessions: 7, comorbidityGAD: false, behavioralActivation: false, seed: 12345, ...over });

// --- §2 Нормалізація --------------------------------------------------------
test('нормалізація шкал у [0,1]', () => {
  assert.equal(normCtsr(6), 1); assert.equal(normCtsr(0), 0); assert.equal(normCtsr(3), 0.5);
  assert.equal(normMiti(5), 1); assert.equal(normMiti(1), 0);
  assert.equal(normRatio(2), 1); assert.equal(normRatio(4), 1); // clamp
  assert.equal(normPct(0.5), 1); assert.equal(normPct(1), 1);   // clamp
});

// --- §3 Суб-компетентності --------------------------------------------------
test('середній рівень оцінки дає суб-скори ~0.5', () => {
  const sub = computeSubScores(makeAssessment());
  for (const k of ['alliance', 'evocation', 'discovery', 'technique', 'structure']) {
    assert.ok(Math.abs(sub[k] - 0.5) < 0.06, `${k}=${sub[k]}`);
  }
});

// --- §11 Монотонність -------------------------------------------------------
test('краща evocation → вища готовність (readiness)', () => {
  const s = makeState();
  const low = updateHidden(s, { alliance: 0.5, evocation: 0.3, discovery: 0.5, technique: 0.5, structure: 0.5 }, 0, true);
  const high = updateHidden(s, { alliance: 0.5, evocation: 0.8, discovery: 0.5, technique: 0.5, structure: 0.5 }, 0, true);
  assert.ok(high.readiness > low.readiness);
});

test('кращий alliance → вищий альянс і нижчий опір', () => {
  const s = makeState();
  const low = updateHidden(s, { alliance: 0.3, evocation: 0.5, discovery: 0.5, technique: 0.5, structure: 0.5 }, 0, true);
  const high = updateHidden(s, { alliance: 0.8, evocation: 0.5, discovery: 0.5, technique: 0.5, structure: 0.5 }, 0, true);
  assert.ok(high.alliance > low.alliance);
  assert.ok(high.resistance < low.resistance);
});

test('розриви (ruptures) шкодять альянсу й готовності', () => {
  const s = makeState();
  const sub = { alliance: 0.6, evocation: 0.6, discovery: 0.5, technique: 0.5, structure: 0.5 };
  const clean = updateHidden(s, sub, 0, true);
  const rough = updateHidden(s, sub, 3, true);
  assert.ok(rough.alliance < clean.alliance);
  assert.ok(rough.resistance > clean.resistance);
});

// --- §11 Clamp --------------------------------------------------------------
test('прихований стан не виходить за [0,100] на крайнощах', () => {
  const hi = updateHidden(makeState({ readiness: 100, alliance: 100, insight: 100, selfEfficacy: 100, resistance: 0 }),
    { alliance: 1, evocation: 1, discovery: 1, technique: 1, structure: 1 }, 0, true);
  for (const k of ['readiness', 'alliance', 'insight', 'selfEfficacy', 'resistance']) {
    assert.ok(hi[k] >= 0 && hi[k] <= 100, `${k}=${hi[k]}`);
  }
  const lo = updateHidden(makeState({ readiness: 0, alliance: 0, insight: 0, selfEfficacy: 0, resistance: 100 }),
    { alliance: 0, evocation: 0, discovery: 0, technique: 0, structure: 0 }, 5, true);
  for (const k of ['readiness', 'alliance', 'insight', 'selfEfficacy', 'resistance']) {
    assert.ok(lo[k] >= 0 && lo[k] <= 100, `${k}=${lo[k]}`);
  }
});

test('спостережувані шкали не виходять за межі', () => {
  const s = makeState({ pacs: 30, gad7: 21, phq9: 27, soberDays: 0 });
  const init = makeState();
  const hidden = updateHidden(s, computeSubScores(makeAssessment()), 0, true);
  const o = updateObservable(s, init, hidden, computeSubScores(makeAssessment()), ctx(), 1, undefined);
  assert.ok(o.pacs >= 0 && o.pacs <= 30);
  assert.ok(o.gad7 >= 0 && o.gad7 <= 21);
  assert.ok(o.phq9 >= 0 && o.phq9 <= 27);
  assert.ok(o.sleep >= 0 && o.sleep <= 10);
});

// --- §11 Релаксація (без овершуту цілі) ------------------------------------
test('крейвінг рухається до цілі й не перестрибує її', () => {
  const s = makeState();
  const sub = computeSubScores(makeAssessment());
  const hidden = updateHidden(s, sub, 0, true);
  const o = updateObservable(s, makeState(), hidden, sub, ctx(), 0.2, undefined);
  const move = o.pacs - s.pacs;
  const delta = o.targets.pacs - s.pacs;
  assert.ok(Math.sign(move) === Math.sign(delta) || move === 0, 'рух у бік цілі');
  assert.ok(Math.abs(move) <= Math.abs(delta) + 0.5, 'без овершуту (з допуском округлення)');
});

// --- §11 Детермінізм --------------------------------------------------------
test('однаковий seed+вхід → ідентичний результат', () => {
  const args = () => ({ state: makeState(), initialState: makeState(), assessment: makeAssessment(), context: ctx() });
  const r1 = stepBetweenSessions(args());
  const r2 = stepBetweenSessions(args());
  assert.deepStrictEqual(r1, r2);
});

test('різний seed може давати інший результат стохастики', () => {
  const base = { state: makeState(), initialState: makeState(), assessment: makeAssessment() };
  const a = stepBetweenSessions({ ...base, context: ctx({ seed: 1 }) });
  const b = stepBetweenSessions({ ...base, context: ctx({ seed: 999999 }) });
  // Хоча б одне з полів стохастики має відрізнятися (статистично майже завжди)
  const differs = a.debug.relapse !== b.debug.relapse || a.debug.triggerSeverity !== b.debug.triggerSeverity || a.debug.dropout !== b.debug.dropout;
  assert.ok(differs);
});

// --- §11 Safety -------------------------------------------------------------
test('пропущена криза безпеки ескалює і штрафує', () => {
  const s = makeState({ suicideRisk: 3, phq9: 14 });
  const handled = stepBetweenSessions({ state: s, initialState: makeState(), assessment: makeAssessment({ events: { safetyHandled: true } }), context: ctx() });
  const missed = stepBetweenSessions({ state: s, initialState: makeState(), assessment: makeAssessment({ events: { safetyHandled: false } }), context: ctx() });

  assert.equal(missed.status, 'crisis');
  assert.ok(missed.events.some(e => e.type === 'crisis'));
  assert.ok(missed.nextState.suicideRisk >= 2);
  // Пропущена криза дає вищу депресію, ніж опрацьована
  assert.ok(missed.nextState.phq9 > handled.nextState.phq9);
});

test('опрацьована криза де-ескалює ризик і додає альянс', () => {
  const s = makeState({ suicideRisk: 2 });
  const handled = stepBetweenSessions({ state: s, initialState: makeState(), assessment: makeAssessment({ events: { safetyHandled: true } }), context: ctx() });
  assert.ok(handled.nextState.suicideRisk < 2);
  assert.notEqual(handled.status, 'crisis');
});

// --- Інтегральний «worked example» (ENGINE §9, напрямки) --------------------
test('хороша MI-сесія (детерміновано): альянс/готовність ростуть, цільовий крейвінг падає', () => {
  const s = makeState();
  const good = makeAssessment({
    ctsr: { feedback: 5, collaboration: 5, interpersonal: 5, guidedDiscovery: 4, keyCognitions: 4 },
    miti: { cultivatingChangeTalk: 4, softeningSustainTalk: 4, partnership: 4, empathy: 4, reflectionToQuestion: 2, complexReflectionPct: 0.5 }
  });
  const sub = computeSubScores(good);
  const hidden = updateHidden(s, sub, 0, true);
  assert.ok(hidden.alliance > s.alliance, 'альянс зріс');
  assert.ok(hidden.readiness > s.readiness, 'готовність зросла');

  // Без тригера: цільовий крейвінг падає завдяки вищій готовності й нижчому опору
  const obs = updateObservable(s, makeState(), hidden, sub, ctx(), 0, undefined);
  assert.ok(obs.targets.pacs < s.pacs, 'цільовий крейвінг нижчий');
  assert.ok(obs.pacs <= s.pacs, 'крейвінг рухається вниз');
});

test('крихкий пацієнт має високий ризик зриву (урок «одна сесія не рятує»)', () => {
  const fragile = makeState({ pacs: 30, readiness: 5, soberDays: 0 });
  const r = stepBetweenSessions({
    state: fragile, initialState: makeState(),
    assessment: makeAssessment({ events: { homeworkAssigned: false } }),
    context: ctx()
  });
  assert.ok(r.nextState.relapseRisk > 70, `relapseRisk=${r.nextState.relapseRisk}`);
});

test('sigmoid у межах (0,1)', () => {
  assert.ok(sigmoid(0) === 0.5);
  assert.ok(sigmoid(10) > 0.99 && sigmoid(-10) < 0.01);
  assert.ok(clamp01(2) === 1 && clamp01(-1) === 0);
});
