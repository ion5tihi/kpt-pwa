// intake.test.js — Тести прийому (конструктор → S₀ + профіль). Фаза 1 / T1.4.
// Запуск: node --test src/clinic/intake.test.js  (або npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intakeFromConstructor } from './intake.js';

const inRange = (x, lo, hi) => x >= lo && x <= hi;

test('усі поля стану в допустимих діапазонах', () => {
  const { initialState: s } = intakeFromConstructor({ type: 'alko', resist: 3, insight: 2, open: 2, risk: 1 });
  assert.ok(inRange(s.pacs, 0, 30), 'pacs');
  assert.ok(inRange(s.gad7, 0, 21), 'gad7');
  assert.ok(inRange(s.phq9, 0, 27), 'phq9');
  for (const k of ['readiness', 'alliance', 'insight', 'selfEfficacy', 'resistance']) {
    assert.ok(inRange(s[k], 0, 100), k);
  }
  assert.ok(inRange(s.suicideRisk, 0, 3), 'suicideRisk');
  assert.equal(s.soberDays, 0);
});

test('залежність дає крейвінг; чиста депресія — майже ні', () => {
  const addiction = intakeFromConstructor({ type: 'alko', resist: 4 }).initialState;
  const pureDep = intakeFromConstructor({ type: 'pure-dep', resist: 4 }).initialState;
  assert.ok(addiction.pacs > 10, 'алко: крейвінг високий');
  assert.ok(pureDep.pacs <= 3, 'чиста депресія: крейвінг низький');
});

test('депресивний профіль → високий PHQ-9; тривожний → високий GAD-7', () => {
  assert.ok(intakeFromConstructor({ type: 'dual-dep' }).initialState.phq9 >= 16);
  assert.ok(intakeFromConstructor({ type: 'dual-gtr' }).initialState.gad7 >= 13);
});

test('вищий опір → вища resistance і нижчий alliance', () => {
  const lo = intakeFromConstructor({ type: 'alko', resist: 1, open: 2 }).initialState;
  const hi = intakeFromConstructor({ type: 'alko', resist: 5, open: 2 }).initialState;
  assert.ok(hi.resistance > lo.resistance);
  assert.ok(hi.alliance < lo.alliance);
});

test('risk ≥2 вмикає suicideRisk=2 (safety-логіка рушія)', () => {
  assert.equal(intakeFromConstructor({ type: 'alko', risk: 0 }).initialState.suicideRisk, 0);
  assert.equal(intakeFromConstructor({ type: 'alko', risk: 2 }).initialState.suicideRisk, 2);
  assert.equal(intakeFromConstructor({ type: 'alko', risk: 3 }).initialState.suicideRisk, 2);
});

test('hiddenState має пріоритет над повзунками; якісні поля переносяться', () => {
  const hs = { resistanceLevel: 5, riskFlag: 2, coreBelief: 'без алкоголю не впораюся',
    hiddenFear: 'страх самотності', resistanceMechanism: 'aggression', trigger: 'конфлікт' };
  const { initialState: s } = intakeFromConstructor({ type: 'alko', resist: 0, risk: 0 }, hs);
  assert.equal(s.resistance, 100);          // 5/5 → 100, а не 0 з повзунка
  assert.equal(s.suicideRisk, 2);           // riskFlag=2, а не 0
  assert.equal(s.coreBelief, 'без алкоголю не впораюся');
  assert.equal(s.resistanceMechanism, 'aggression');
  assert.equal(s.primaryTrigger, 'конфлікт');
});

test('профіль зберігає disorderType (для коморбідності рушія) і stage', () => {
  const { profile } = intakeFromConstructor({ type: 'dual-gtr', stage: 'детокс' });
  assert.equal(profile.disorderType, 'dual-gtr');
  assert.equal(profile.treatmentStage, 'детокс');
});

test('повний прогін: S₀ сумісний із рушієм (один крок без помилок)', async () => {
  const { createCase, recordSessionOutcome } = await import('./case.js');
  const { buildAssessment } = await import('./assessment.js');
  const { profile, initialState } = intakeFromConstructor({ type: 'alko', resist: 3, insight: 2, open: 2, risk: 1 });
  const k = createCase({ profile, initialState, seed: 42 });
  const { result } = recordSessionOutcome(k, buildAssessment({ ctsr: { feedback: 5 } }));
  assert.ok(result.nextState && typeof result.nextState.pacs === 'number');
});
