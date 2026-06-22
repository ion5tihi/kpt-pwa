// profile.test.js — Тести профілю компетентності стажера (Фаза 4 / T4.1).
// Запуск: node --test src/clinic/profile.test.js  (або npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTraineeProfile, buildCaseReport } from './profile.js';
import { buildAssessment } from './assessment.js';

// Хелпер: мінімальний Case з сесіями (профілю потрібні лише sessions/status/events/state/outcome).
function mkCase({ status = 'active', sessions = [], events = [], outcome = null, state = null } = {}) {
  return { status, sessions, events, outcome, state };
}
function mkSession(index, date, asmtOver = {}) {
  return { index, date, assessment: buildAssessment(asmtOver) };
}

test('порожній набір → нульовий профіль, без падінь', () => {
  const p = buildTraineeProfile({});
  assert.equal(p.sessionsCompleted, 0);
  assert.equal(p.casesCompleted, 0);
  assert.equal(p.avgCtsr, 0);
  assert.deepEqual(p.ctsrTrend, []);
  assert.deepEqual(p.weakestCtsrItems, []);
  assert.deepEqual(p.recommendations, []);
  assert.deepEqual(p.outcomesByStatus, { active: 0, discharged: 0, dropped_out: 0, crisis: 0 });
});

test('лічильники: сесії з оцінкою та закриті випадки', () => {
  const cases = {
    a: mkCase({ status: 'active', sessions: [mkSession(1, '2026-01-01'), mkSession(2, '2026-01-08')] }),
    b: mkCase({ status: 'discharged', sessions: [mkSession(1, '2026-01-02')] }),
    c: mkCase({ status: 'dropped_out', sessions: [mkSession(1, '2026-01-03')] })
  };
  const p = buildTraineeProfile(cases);
  assert.equal(p.sessionsCompleted, 4);
  assert.equal(p.casesCompleted, 2); // discharged + dropped_out
  assert.equal(p.outcomesByStatus.active, 1);
  assert.equal(p.outcomesByStatus.discharged, 1);
  assert.equal(p.outcomesByStatus.dropped_out, 1);
});

test('приймає і масив, і мапу випадків', () => {
  const arr = [mkCase({ sessions: [mkSession(1, '2026-01-01')] })];
  assert.equal(buildTraineeProfile(arr).sessionsCompleted, 1);
});

test('тренди хронологічні (за датою) і довжиною = к-сть сесій', () => {
  const cases = {
    a: mkCase({ sessions: [mkSession(2, '2026-02-01', { ctsr: { agenda: 6 } })] }),
    b: mkCase({ sessions: [mkSession(1, '2026-01-01', { ctsr: { agenda: 0 } })] })
  };
  const p = buildTraineeProfile(cases);
  assert.equal(p.ctsrTrend.length, 2);
  assert.equal(p.reflectionRatioTrend.length, 2);
  // 2026-01-01 має йти першим
  assert.ok(p.ctsrTrend[0] < p.ctsrTrend[1]);
});

test('weakestCtsrItems ловить хронічно слабкий пункт', () => {
  const low = { ctsr: { homework: 0, agenda: 6, feedback: 6, collaboration: 6 } };
  const cases = { a: mkCase({ sessions: [mkSession(1, '2026-01-01', low), mkSession(2, '2026-01-08', low)] }) };
  const p = buildTraineeProfile(cases);
  assert.ok(p.weakestCtsrItems.includes('homework'));
  assert.equal(p.ctsrItemAverages.homework, 0);
});

test('avgCtsr = середній ctsrTotal по сесіях', () => {
  // дефолтна оцінка має ctsrTotal 36; одна з усіма 6 = 72 → середнє 54
  const cases = { a: mkCase({ sessions: [
    mkSession(1, '2026-01-01'),
    mkSession(2, '2026-01-08', { ctsr: Object.fromEntries('agenda feedback collaboration pacing interpersonal guidedDiscovery conceptualization keyCognitions focusEmotion focusBehavior techniques homework'.split(' ').map(k => [k, 6])) })
  ] }) };
  const p = buildTraineeProfile(cases);
  assert.equal(p.avgCtsr, 54);
});

test('safetyResponses: faced/handled/missedCrises', () => {
  const cases = {
    a: mkCase({ sessions: [
      mkSession(1, '2026-01-01', { events: { safetyFlagPresent: true, safetyHandled: true } }),
      mkSession(2, '2026-01-08', { events: { safetyFlagPresent: true, safetyHandled: false } })
    ], events: [{ type: 'crisis', afterSessionIndex: 2 }], status: 'crisis' })
  };
  const p = buildTraineeProfile(cases);
  assert.equal(p.safetyResponses.faced, 2);
  assert.equal(p.safetyResponses.handled, 1);
  assert.equal(p.safetyResponses.missedCrises, 1);
});

test('recommendations: слабкий пункт CTS-R + низький MITI потрапляють у поради', () => {
  const weak = { ctsr: { homework: 0 }, miti: { empathy: 1, partnership: 1 } };
  const cases = { a: mkCase({ sessions: [mkSession(1, '2026-01-01', weak)] }) };
  const recs = buildTraineeProfile(cases).recommendations;
  assert.ok(recs.length > 0);
  assert.ok(recs.some(r => r.kind === 'ctsr'));
  assert.ok(recs.some(r => r.kind === 'miti'));
  assert.ok(recs.length <= 5);
});

test('buildCaseReport: середній CTS-R, к-сть сесій, поворотні моменти', () => {
  const kase = mkCase({
    status: 'dropped_out',
    sessions: [mkSession(1, '2026-01-01'), mkSession(2, '2026-01-08')],
    events: [{ type: 'relapse', afterSessionIndex: 1 }, { type: 'life_trigger', afterSessionIndex: 2 }],
    outcome: { summary: 'Пацієнт припинив лікування.' },
    state: { pacs: 25 }
  });
  const r = buildCaseReport(kase);
  assert.equal(r.sessions, 2);
  assert.equal(r.avgCtsr, 36);
  assert.equal(r.status, 'dropped_out');
  assert.equal(r.summary, 'Пацієнт припинив лікування.');
  assert.equal(r.keyMoments.length, 1); // лише relapse (не life_trigger)
  assert.equal(r.eventsByType.relapse, 1);
  assert.equal(r.eventsByType.life_trigger, 1);
});

test('buildCaseReport(null) → null', () => {
  assert.equal(buildCaseReport(null), null);
});
