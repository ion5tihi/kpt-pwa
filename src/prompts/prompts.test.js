// prompts.test.js — Sanity-тести версіонованих промптів (T3.5).
// Не перевіряють точний текст (він може еволюціонувати), лише структурні інваріанти.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMPTS_VERSION, systemPrompt, evalPrompt, structuredEvalPrompt,
  patientGenerationPrompt, repeatSessionPrompt
} from './prompts.js';

test('версія промптів — додатне ціле', () => {
  assert.ok(Number.isInteger(PROMPTS_VERSION) && PROMPTS_VERSION >= 1);
});

test('systemPrompt: базовий або кастомний; додає картку та прихований стан', () => {
  assert.ok(systemPrompt('').length > 100);
  assert.equal(systemPrompt('МІЙ ПРОМПТ').startsWith('МІЙ ПРОМПТ'), true);
  const withCard = systemPrompt('', null, 'КАРТКА-XYZ');
  assert.ok(withCard.includes('КАРТКА-XYZ'));
  const withHidden = systemPrompt('', { trigger: 'конфлікт', coreBelief: 'cb', resistanceLevel: 4, resistanceMechanism: 'aggression', hiddenFear: 'hf', riskFlag: 2 });
  assert.ok(withHidden.includes('конфлікт') && withHidden.includes('aggression'));
});

test('evalPrompt: текстовий звіт з 12 пунктами і MITI', () => {
  const p = evalPrompt();
  assert.ok(p.includes('CTS-R') && p.includes('12') && p.includes('MITI'));
});

test('structuredEvalPrompt: містить ключі схеми (ctsr/miti/events)', () => {
  const p = structuredEvalPrompt();
  assert.ok(p.includes('ctsr') && p.includes('miti') && p.includes('events'));
  assert.ok(p.includes('safetyHandled') && p.includes('ruptures'));
});

test('patientGenerationPrompt: manual містить typeLabel і параметри; обидва — JSON-поля', () => {
  const manual = patientGenerationPrompt({ mode: 'manual', type: 'alko', stage: 'детокс', resist: 4, insight: 2, open: 3, risk: 1 }, 'алкогольна залежність');
  assert.ok(manual.includes('алкогольна залежність') && manual.includes('hiddenState'));
  const auto = patientGenerationPrompt({ mode: 'auto' }, 'x');
  assert.ok(auto.includes('випадковий') && auto.includes('hiddenState'));
});

test('repeatSessionPrompt: номер сесії, етап, ім’я', () => {
  const p = repeatSessionPrompt({ sessionNumber: 3, stage: 'стабілізація', patientName: 'Олег' });
  assert.ok(p.includes('№3') && p.includes('стабілізація') && p.includes('Олег'));
});
