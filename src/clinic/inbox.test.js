// inbox.test.js — Тести інбоксу подій клініки (T5.3).
// Запуск: node --test src/clinic/inbox.test.js  (або npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INBOX_PARAMS, caseNeedsFollowup, makeMissedSessionEvent, makeUrgentIntakeEvent,
  pickUrgentTemplate, isUrgentTemplate, hasPendingEvents, pendingCount
} from './inbox.js';
import { createCase, applyMissedSession } from './case.js';

const mkState = (over = {}) => ({
  pacs: 15, gad7: 8, phq9: 14, soberDays: 14, sleep: 5,
  readiness: 40, alliance: 45, insight: 40, selfEfficacy: 35, resistance: 40,
  relapseRisk: 20, dropoutRisk: 40, suicideRisk: 0, homeworkAdherence: 0.3,
  coreBelief: '', hiddenFear: '', resistanceMechanism: 'tears', primaryTrigger: '', ...over
});
const mkCase = (over = {}) => createCase({ profile: { displayName: 'Іван', disorderType: 'alko' }, initialState: mkState(over), seed: 1 });

test('caseNeedsFollowup: лише активний кейс із dropoutRisk ≥ порога', () => {
  assert.equal(caseNeedsFollowup(mkCase({ dropoutRisk: 40 })), true);
  assert.equal(caseNeedsFollowup(mkCase({ dropoutRisk: 10 })), false);
  const closed = mkCase({ dropoutRisk: 90 }); closed.status = 'discharged';
  assert.equal(caseNeedsFollowup(closed), false);
  assert.equal(caseNeedsFollowup(null), false);
});

test('makeMissedSessionEvent: pending, 3 опції, привʼязаний до коду', () => {
  const e = makeMissedSessionEvent('Т-Іван', mkCase());
  assert.equal(e.type, 'missed_session');
  assert.equal(e.caseCode, 'Т-Іван');
  assert.equal(e.status, 'pending');
  assert.deepEqual(e.options.map((o) => o.id), ['outreach', 'wait', 'discharge']);
  assert.ok(e.title.includes('Іван'));
});

test('makeUrgentIntakeEvent: несе templateId і 2 опції; невідомий шаблон кидає', () => {
  const e = makeUrgentIntakeEvent('stim-intellectual-03');
  assert.equal(e.type, 'urgent_intake');
  assert.equal(e.templateId, 'stim-intellectual-03');
  assert.deepEqual(e.options.map((o) => o.id), ['accept', 'defer']);
  assert.throws(() => makeUrgentIntakeEvent('no-such'), /Невідомий шаблон/);
});

test('pickUrgentTemplate: детермінований, гострий кейс, уникає вже взятих', () => {
  const a = pickUrgentTemplate(7);
  const b = pickUrgentTemplate(7);
  assert.equal(a.id, b.id, 'той самий seed → той самий шаблон');
  assert.ok(isUrgentTemplate(a), 'обрано гострий кейс (ризик / сценарна подія)');
  const next = pickUrgentTemplate(7, [a.id]);
  assert.notEqual(next.id, a.id, 'уникає вже використаного шаблону');
});

test('hasPendingEvents / pendingCount', () => {
  const inbox = [{ status: 'pending' }, { status: 'resolved' }, { status: 'pending' }];
  assert.equal(hasPendingEvents(inbox), true);
  assert.equal(pendingCount(inbox), 2);
  assert.equal(hasPendingEvents([]), false);
  assert.equal(pendingCount(undefined), 0);
});

// ---- applyMissedSession ----

test('outreach: альянс ↑, ризик відмови ↓, подія записана, кейс активний', () => {
  const k = mkCase({ alliance: 45, dropoutRisk: 40 });
  const r = applyMissedSession(k, 'outreach');
  assert.equal(r.closed, false);
  assert.equal(k.status, 'active');
  assert.equal(k.state.alliance, 45 + INBOX_PARAMS.missed.outreach.alliance);
  assert.equal(k.state.dropoutRisk, 40 + INBOX_PARAMS.missed.outreach.dropoutRisk);
  assert.ok(k.events.some((e) => e.type === 'missed_session'));
});

test('wait: альянс ↓, ризик ↑', () => {
  const k = mkCase({ alliance: 45, dropoutRisk: 40 });
  applyMissedSession(k, 'wait');
  assert.equal(k.state.alliance, 45 + INBOX_PARAMS.missed.wait.alliance);
  assert.equal(k.state.dropoutRisk, 40 + INBOX_PARAMS.missed.wait.dropoutRisk);
  assert.equal(k.status, 'active');
});

test('discharge: закриває випадок як dropped_out з outcome', () => {
  const k = mkCase();
  const r = applyMissedSession(k, 'discharge');
  assert.equal(r.closed, true);
  assert.equal(k.status, 'dropped_out');
  assert.ok(k.outcome && k.outcome.status === 'dropped_out');
  assert.ok(k.events.some((e) => e.type === 'missed_session'));
});

test('applyMissedSession: клемп у [0,100] і захист від закритого кейса', () => {
  const k = mkCase({ alliance: 2, dropoutRisk: 95 });
  applyMissedSession(k, 'wait'); // alliance 2-8 → 0, dropoutRisk 95+12 → 100
  assert.equal(k.state.alliance, 0);
  assert.equal(k.state.dropoutRisk, 100);
  k.status = 'discharged';
  assert.throws(() => applyMissedSession(k, 'outreach'), /Випадок закрито/);
});
