// scripted.test.js — Тести сценарних подій (T5.2): pre-session криза + between-session override.
// Запуск: node --test src/clinic/scripted.test.js  (або npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getScriptedForSession, applyPreSessionScript, scriptedContext, hasScriptedEvents
} from './scripted.js';
import { createCase, recordSessionOutcome, beginSession } from './case.js';

const baseState = {
  pacs: 10, gad7: 6, phq9: 8, soberDays: 30, sleep: 6,
  readiness: 50, alliance: 55, insight: 50, selfEfficacy: 40, resistance: 30,
  relapseRisk: 0, dropoutRisk: 0, suicideRisk: 0, homeworkAdherence: 0.3,
  coreBelief: '', hiddenFear: '', resistanceMechanism: 'tears', primaryTrigger: ''
};
// «Достатньо добра» оцінка — щоб без сценарію НЕ було ні кризи, ні форсованих подій.
const okAssessment = () => ({
  ctsr: { agenda: 4, feedback: 4, collaboration: 4, pacing: 4, interpersonal: 4, guidedDiscovery: 4,
    conceptualization: 4, keyCognitions: 4, focusEmotion: 4, focusBehavior: 4, techniques: 4, homework: 4 },
  miti: { partnership: 4, empathy: 4, cultivatingChangeTalk: 4, softeningSustainTalk: 4,
    reflectionToQuestion: 2, complexReflectionPct: 0.5 },
  events: { safetyFlagPresent: false, safetyHandled: false, homeworkAssigned: true, ruptures: 0 },
  durationTurns: 10
});

test('getScriptedForSession фільтрує за atSession', () => {
  const evs = [{ atSession: 2, type: 'relapse' }, { atSession: 3, type: 'safety_crisis' }];
  assert.equal(getScriptedForSession(evs, 3).length, 1);
  assert.equal(getScriptedForSession(evs, 3)[0].type, 'safety_crisis');
  assert.equal(getScriptedForSession(evs, 9).length, 0);
  assert.equal(getScriptedForSession(undefined, 1).length, 0);
});

test('applyPreSessionScript: safety_crisis піднімає ризик ≥2 і повертає riskFlag', () => {
  const out = applyPreSessionScript(baseState, [{ atSession: 1, type: 'safety_crisis' }], 1);
  assert.ok(out.state.suicideRisk >= 2);
  assert.ok(out.state.phq9 >= 18, 'криза підтягує депресію для когерентності');
  assert.equal(out.riskFlag, 2);
  assert.equal(out.applied.length, 1);
  assert.equal(baseState.suicideRisk, 0, 'вхідний стан не мутується');
});

test('applyPreSessionScript: нема події на цій сесії → стан без змін, riskFlag null', () => {
  const out = applyPreSessionScript(baseState, [{ atSession: 5, type: 'safety_crisis' }], 1);
  assert.equal(out.riskFlag, null);
  assert.equal(out.applied.length, 0);
  assert.equal(out.state.suicideRisk, 0);
});

test('scriptedContext: life_trigger і relapse дають override-поля', () => {
  const t = scriptedContext([{ atSession: 2, type: 'life_trigger', severity: 0.9 }], 2);
  assert.equal(t.forceTrigger, true);
  assert.equal(t.forcedTriggerSeverity, 0.9);
  const r = scriptedContext([{ atSession: 2, type: 'relapse' }], 2);
  assert.equal(r.forceRelapse, true);
  assert.equal(r.forceTrigger, true);
  assert.deepEqual(scriptedContext([{ atSession: 2, type: 'relapse' }], 3), {});
});

test('hasScriptedEvents', () => {
  assert.equal(hasScriptedEvents([{ atSession: 1, type: 'relapse' }]), true);
  assert.equal(hasScriptedEvents([]), false);
  assert.equal(hasScriptedEvents(undefined), false);
});

// ---- Інтеграція в Case ----

test('createCase зберігає scriptedEvents; beginSession застосовує pre-session кризу', () => {
  const scripted = [{ atSession: 1, type: 'safety_crisis', riskLevel: 2 }];
  const kase = createCase({ profile: { disorderType: 'pure-dep' }, initialState: baseState, seed: 42, scriptedEvents: scripted });
  assert.equal(kase.scriptedEvents.length, 1);
  const { applied, riskFlag } = beginSession(kase, 1);
  assert.equal(applied.length, 1);
  assert.equal(riskFlag, 2);
  assert.ok(kase.state.suicideRisk >= 2, 'стан кейса оновлено');
});

test('сценарна криза → закриває випадок, якщо стажер не опрацював безпеку', () => {
  const scripted = [{ atSession: 1, type: 'safety_crisis' }];
  const kase = createCase({ profile: { disorderType: 'pure-dep' }, initialState: baseState, seed: 7, scriptedEvents: scripted });
  beginSession(kase, 1);
  const { result } = recordSessionOutcome(kase, okAssessment()); // safetyHandled=false
  assert.equal(result.status, 'crisis');
  assert.equal(kase.status, 'crisis');
  assert.ok(result.events.some((e) => e.type === 'crisis'));
});

test('та сама криза опрацьована (safetyHandled) → не криза, ризик знижено', () => {
  const scripted = [{ atSession: 1, type: 'safety_crisis' }];
  const kase = createCase({ profile: { disorderType: 'pure-dep' }, initialState: baseState, seed: 7, scriptedEvents: scripted });
  beginSession(kase, 1);
  const riskEntering = kase.state.suicideRisk; // ≥2 після pre-session
  const a = okAssessment(); a.events.safetyHandled = true;
  const { result } = recordSessionOutcome(kase, a);
  assert.notEqual(result.status, 'crisis', 'опрацьована криза не закриває випадок кризою');
  assert.ok(!result.events.some((e) => e.type === 'crisis'), 'події кризи немає');
  assert.ok(kase.state.suicideRisk < riskEntering, 'ризик знижено бонусом safety-handled');
});

test('between-session relapse форсується сценарієм навіть при добрій сесії', () => {
  const scripted = [{ atSession: 1, type: 'relapse', severity: 0.8 }];
  const kase = createCase({ profile: { disorderType: 'alko' }, initialState: baseState, seed: 123, scriptedEvents: scripted });
  const { result } = recordSessionOutcome(kase, okAssessment());
  const relapseEv = result.events.find((e) => e.type === 'relapse');
  assert.ok(relapseEv, 'зрив відбувся попри добру роботу');
  assert.equal(relapseEv.scripted, true, 'подію позначено як сценарну');
  assert.equal(kase.state.soberDays, 0, 'тверезість обнулено зривом');
});

test('без сценарію та сама добра сесія НЕ дає форсованого зриву (контроль)', () => {
  const kase = createCase({ profile: { disorderType: 'alko' }, initialState: baseState, seed: 123 });
  const { result } = recordSessionOutcome(kase, okAssessment());
  const relapseEv = result.events.find((e) => e.type === 'relapse');
  assert.ok(!relapseEv || !relapseEv.scripted, 'без сценарію немає сценарного зриву');
});
