// templates.test.js — Тести бібліотеки шаблонів кейсів (T5.1).
// Запуск: node --test src/clinic/templates.test.js  (або npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_TEMPLATES, TEMPLATES_VERSION, DIFFICULTY_LABELS,
  getTemplate, listTemplates, templatesByDifficulty,
  applyStatePreset, intakeFromTemplate
} from './templates.js';

const inRange = (x, lo, hi) => x >= lo && x <= hi;

test('версія — непорожній рядок', () => {
  assert.ok(typeof TEMPLATES_VERSION === 'string' && TEMPLATES_VERSION.length > 0);
});

test('бібліотека: ≥5 шаблонів, унікальні id, валідні поля', () => {
  assert.ok(CASE_TEMPLATES.length >= 5, 'щонайменше 5 шаблонів');
  const ids = new Set(CASE_TEMPLATES.map((t) => t.id));
  assert.equal(ids.size, CASE_TEMPLATES.length, 'id унікальні');
  for (const t of CASE_TEMPLATES) {
    assert.ok(t.title && t.disorderType && t.stage, `${t.id}: базові поля`);
    assert.ok(inRange(t.difficulty, 1, 5), `${t.id}: difficulty 1..5`);
    assert.ok(Array.isArray(t.learningObjectives) && t.learningObjectives.length > 0, `${t.id}: цілі`);
    assert.ok(typeof t.clinicalBrief === 'string' && t.clinicalBrief.length > 20, `${t.id}: бриф`);
    assert.equal(typeof t.clinicianReviewed, 'boolean', `${t.id}: прапор валідації`);
    const c = t.constructorConfig;
    assert.ok(inRange(c.resist, 0, 5) && inRange(c.insight, 0, 5) && inRange(c.open, 0, 5) && inRange(c.risk, 0, 3),
      `${t.id}: конфіг повзунків у межах`);
    assert.ok(Array.isArray(t.scriptedEvents), `${t.id}: scriptedEvents — масив`);
    for (const e of t.scriptedEvents) {
      assert.ok(Number.isInteger(e.atSession) && e.atSession >= 1, `${t.id}: atSession ≥1`);
      assert.ok(['safety_crisis', 'life_trigger', 'relapse'].includes(e.type), `${t.id}: валідний тип події`);
    }
  }
});

test('прогресія складності: представлені рівні 1..5', () => {
  const levels = new Set(CASE_TEMPLATES.map((t) => t.difficulty));
  for (let d = 1; d <= 5; d++) assert.ok(levels.has(d), `рівень ${d} присутній`);
  for (const d of levels) assert.ok(DIFFICULTY_LABELS[d], `мітка для рівня ${d}`);
});

test('getTemplate / listTemplates / templatesByDifficulty', () => {
  const t = CASE_TEMPLATES[0];
  assert.equal(getTemplate(t.id), t);
  assert.equal(getTemplate('не-існує'), null);

  const d5 = listTemplates({ difficulty: 5 });
  assert.ok(d5.length >= 1 && d5.every((x) => x.difficulty === 5));
  assert.ok(listTemplates({ disorderType: t.disorderType }).every((x) => x.disorderType === t.disorderType));

  const grouped = templatesByDifficulty();
  const order = grouped.map((g) => g.difficulty);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'групи відсортовані за зростанням');
  const total = grouped.reduce((n, g) => n + g.items.length, 0);
  assert.equal(total, CASE_TEMPLATES.length, 'усі шаблони згруповано');
});

test('applyStatePreset: клемпує числа, перезаписує рядки, ігнорує сміття', () => {
  const base = { pacs: 10, alliance: 50, suicideRisk: 0, coreBelief: 'old', homeworkAdherence: 0.3 };
  const out = applyStatePreset(base, {
    pacs: 999,            // > max 30 → клемп
    alliance: -5,         // < 0 → клемп
    suicideRisk: 2,
    coreBelief: 'new',
    homeworkAdherence: 0.9,
    bogusField: 123,      // невідоме → ігнор
    soberDays: null       // null → пропуск
  });
  assert.equal(out.pacs, 30);
  assert.equal(out.alliance, 0);
  assert.equal(out.suicideRisk, 2);
  assert.equal(out.coreBelief, 'new');
  assert.equal(out.homeworkAdherence, 0.9);
  assert.ok(!('bogusField' in out));
  assert.equal(base.pacs, 10, 'вхідний стан не мутується');
});

test('intakeFromTemplate: повертає валідний стан у межах + метадані профілю', () => {
  for (const t of CASE_TEMPLATES) {
    const { profile, initialState: s, template } = intakeFromTemplate(t.id, null, { displayName: 'Тест' });
    assert.equal(template.id, t.id);
    assert.equal(profile.templateId, t.id);
    assert.equal(profile.difficulty, t.difficulty);
    assert.equal(profile.disorderType, t.disorderType);
    assert.ok(inRange(s.pacs, 0, 30) && inRange(s.gad7, 0, 21) && inRange(s.phq9, 0, 27), `${t.id}: шкали`);
    for (const k of ['readiness', 'alliance', 'insight', 'selfEfficacy', 'resistance']) {
      assert.ok(inRange(s[k], 0, 100), `${t.id}: ${k}`);
    }
    assert.ok(inRange(s.suicideRisk, 0, 3), `${t.id}: suicideRisk`);
  }
});

test('intakeFromTemplate: безпековий кейс (D4) несе ризик ≥2', () => {
  const { initialState } = intakeFromTemplate('pure-dep-risk-04');
  assert.ok(initialState.suicideRisk >= 2, 'кризовий шаблон вмикає safety-логіку рушія');
});

test('intakeFromTemplate: живий hiddenState має пріоритет над рядками пресету', () => {
  const live = { coreBelief: 'від LLM', trigger: 'тригер-LLM', resistanceLevel: 3, riskFlag: 0 };
  const { initialState } = intakeFromTemplate('stim-intellectual-03', live);
  assert.equal(initialState.coreBelief, 'від LLM', 'рядок із LLM не перетерто пресетом');
  assert.equal(initialState.primaryTrigger, 'тригер-LLM');
});

test('intakeFromTemplate: невідомий id кидає помилку', () => {
  assert.throws(() => intakeFromTemplate('no-such-template'), /Невідомий шаблон/);
});
