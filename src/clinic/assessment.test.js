// assessment.test.js — Тести моста «сирий JSON оцінки → Assessment» (Фаза 1 / T1.4).
// Запуск: node --test src/clinic/assessment.test.js  (або npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssessment, assessmentJsonSchema, CTSR_ITEM_KEYS, MITI_GLOBAL_KEYS } from './assessment.js';
import { computeSubScores } from '../engine/engine.js';

// Рекурсивна перевірка strict-сумісності схеми OpenAI Structured Outputs.
function assertStrict(node) {
  if (node.type === 'object') {
    assert.equal(node.additionalProperties, false, 'object має additionalProperties:false');
    assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), 'усі властивості в required');
    for (const v of Object.values(node.properties)) assertStrict(v);
  }
  // strict-режим не підтримує minimum/maximum
  assert.equal('minimum' in node, false, 'без minimum');
  assert.equal('maximum' in node, false, 'без maximum');
}

test('порожній вхід → валідний Assessment із нейтральними дефолтами', () => {
  const a = buildAssessment();
  assert.equal(Object.keys(a.ctsr).length, 12);
  for (const k of CTSR_ITEM_KEYS) assert.equal(a.ctsr[k], 3);
  assert.equal(a.ctsrTotal, 36); // 12 × 3
  for (const k of MITI_GLOBAL_KEYS) assert.equal(a.miti[k], 3);
  assert.equal(a.miti.reflectionToQuestion, 1);
  assert.equal(a.miti.complexReflectionPct, 0.25);
  assert.deepEqual(a.events, { safetyFlagPresent: false, safetyHandled: false, homeworkAssigned: false, ruptures: 0 });
});

test('CTS-R: клемпінг у 0–6 і округлення', () => {
  const a = buildAssessment({ ctsr: { agenda: 99, feedback: -5, collaboration: 4.4, pacing: 4.6 } });
  assert.equal(a.ctsr.agenda, 6);
  assert.equal(a.ctsr.feedback, 0);
  assert.equal(a.ctsr.collaboration, 4);
  assert.equal(a.ctsr.pacing, 5);
});

test('ctsrTotal = сума 12 пунктів після клемпінгу', () => {
  const all6 = CTSR_ITEM_KEYS.reduce((o, k) => ((o[k] = 6), o), {});
  assert.equal(buildAssessment({ ctsr: all6 }).ctsrTotal, 72);
});

test('MITI: глобали клемпляться 1–5; ratio ≥0; pct у 0–1', () => {
  const a = buildAssessment({ miti: { partnership: 9, empathy: 0, reflectionToQuestion: -3, complexReflectionPct: 2 } });
  assert.equal(a.miti.partnership, 5);
  assert.equal(a.miti.empathy, 1);
  assert.equal(a.miti.reflectionToQuestion, 0);
  assert.equal(a.miti.complexReflectionPct, 1);
});

test('events: коерсія типів (bool/ціле ≥0)', () => {
  const a = buildAssessment({ events: { safetyHandled: 1, homeworkAssigned: 'так', ruptures: -2.7 } });
  assert.equal(a.events.safetyHandled, true);
  assert.equal(a.events.homeworkAssigned, true);
  assert.equal(a.events.ruptures, 0);          // -2.7 → max(0, round) = 0
  assert.equal(a.events.safetyFlagPresent, false);
});

test('passthrough: narrative/strengths/growthAreas/durationTurns', () => {
  const a = buildAssessment({ narrative: '## звіт', strengths: ['a', 'b'], growthAreas: ['c'], durationTurns: 12 });
  assert.equal(a.narrative, '## звіт');
  assert.deepEqual(a.strengths, ['a', 'b']);
  assert.deepEqual(a.growthAreas, ['c']);
  assert.equal(a.durationTurns, 12);
});

test('сміттєві типи → дефолти, не падає', () => {
  const a = buildAssessment({ ctsr: 'nope', miti: null, events: 42, strengths: 'x', narrative: 5 });
  assert.equal(a.ctsrTotal, 36);
  assert.equal(a.miti.partnership, 3);
  assert.equal(a.events.ruptures, 0);
  assert.deepEqual(a.strengths, []);
  assert.equal(a.narrative, '');
});

test('результат сумісний із рушієм (computeSubScores не падає, усі 0–1)', () => {
  const sub = computeSubScores(buildAssessment({ ctsr: { feedback: 5 }, miti: { empathy: 5 } }));
  for (const v of Object.values(sub)) {
    assert.ok(v >= 0 && v <= 1, `subScore поза 0–1: ${v}`);
  }
});

test('assessmentJsonSchema: strict-сумісна, покриває ctsr(12)/miti(6)/events(4)', () => {
  const s = assessmentJsonSchema();
  assertStrict(s);
  assert.deepEqual([...s.required].sort(), ['ctsr', 'events', 'miti']);
  assert.equal(Object.keys(s.properties.ctsr.properties).length, 12);
  assert.equal(Object.keys(s.properties.miti.properties).length, 6);
  assert.equal(Object.keys(s.properties.events.properties).length, 4);
});

test('вихід за схемою → buildAssessment приймає без втрат', () => {
  // Імітуємо валідний json_schema-вихід LLM і проганяємо через міст
  const raw = {
    ctsr: CTSR_ITEM_KEYS.reduce((o, k) => ((o[k] = 4), o), {}),
    miti: { cultivatingChangeTalk: 4, softeningSustainTalk: 4, partnership: 4, empathy: 4, reflectionToQuestion: 1.5, complexReflectionPct: 0.4 },
    events: { safetyFlagPresent: false, safetyHandled: false, homeworkAssigned: true, ruptures: 1 }
  };
  const a = buildAssessment(raw);
  assert.equal(a.ctsrTotal, 48);
  assert.equal(a.events.ruptures, 1);
  assert.equal(a.miti.partnership, 4);
});
