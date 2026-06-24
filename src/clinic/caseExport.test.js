// caseExport.test.js — Тести експорту кейса для супервізора.
// Запуск: node --test src/clinic/caseExport.test.js  (або npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseExport, caseExportToHtml } from './caseExport.js';

const asmt = (over = {}) => ({
  ctsr: { agenda: 4, feedback: 3, collaboration: 5, pacing: 4, interpersonal: 4, guidedDiscovery: 3,
    conceptualization: 4, keyCognitions: 2, focusEmotion: 3, focusBehavior: 4, techniques: 4, homework: 4 },
  ctsrTotal: 44,
  miti: { partnership: 4, empathy: 4, cultivatingChangeTalk: 3, softeningSustainTalk: 3, reflectionToQuestion: 1.8, complexReflectionPct: 0.45 },
  events: { safetyFlagPresent: true, safetyHandled: true, homeworkAssigned: true, ruptures: 1 },
  narrative: 'Сильна емпатія, варто посилити роботу з ключовими когніціями.',
  durationTurns: 6, ...over
});

const kase = {
  profile: { displayName: 'Олег, 35', disorderType: 'dual-dep', treatmentStage: 'рання реабілітація', difficulty: 2, templateTitle: 'Подвійний тягар' },
  status: 'discharged',
  state: { pacs: 8, phq9: 10, gad7: 6, readiness: 70, alliance: 65, soberDays: 90 },
  outcome: { summary: 'Стабільна ремісія.', keyMoments: [{ sessionIndex: 2, note: 'Зрив' }] },
  events: [{ type: 'relapse', afterSessionIndex: 2 }, { type: 'life_trigger', afterSessionIndex: 1 }],
  sessions: [
    { index: 1, date: '2026-06-01', assessment: asmt() },
    { index: 2, date: '2026-06-08', assessment: asmt({ ctsrTotal: 50 }) }
  ]
};
const patient = {
  records: [
    { isPractice: true, date: '2026-06-01', dialogue: [
      { type: 'card', text: 'КАРТКА' },
      { type: 'patient', text: 'Мені важко.' },
      { type: 'you', text: 'Розкажіть детальніше.' },
      { type: 'hint', text: '', hint: {} }
    ], ctsReport: 'fallback-наратив' },
    { isPractice: true, date: '2026-06-08', dialogue: [
      { type: 'you', text: 'Як минув тиждень?' },
      { type: 'patient', text: 'Краще.' }
    ] }
  ]
};

test('buildCaseExport: meta, дві сесії, транскрипт без card/hint', () => {
  const exp = buildCaseExport(kase, patient, { typeLabel: 'залежність + депресія' });
  assert.equal(exp.meta.name, 'Олег, 35');
  assert.equal(exp.meta.typeLabel, 'залежність + депресія');
  assert.equal(exp.meta.statusLabel, 'Виписка (успіх)');
  assert.equal(exp.meta.sessionsCount, 2);
  const s1 = exp.sessions[0];
  assert.equal(s1.transcript.length, 2, 'лише patient+you, без card/hint');
  assert.deepEqual(s1.transcript.map((t) => t.role), ['Пацієнт', 'Терапевт']);
  assert.equal(s1.ctsrTotal, 44);
  assert.equal(s1.narrative.includes('емпатія'), true);
});

test('buildCaseExport: narrative-фолбек на ctsReport, durationTurns із ходів', () => {
  const k2 = structuredClone(kase);
  k2.sessions[0].assessment.narrative = '';      // немає структурного наративу
  const exp = buildCaseExport(k2, patient);
  assert.equal(exp.sessions[0].narrative, 'fallback-наратив');
});

test('buildCaseExport: працює без пацієнта (порожні транскрипти)', () => {
  const exp = buildCaseExport(kase, null);
  assert.equal(exp.sessions.length, 2);
  assert.equal(exp.sessions[0].transcript.length, 0);
});

test('buildCaseExport: кидає без кейса', () => {
  assert.throws(() => buildCaseExport(null), /Немає кейса/);
});

test('caseExportToHtml: валідний самодостатній HTML з ключовими блоками', () => {
  const html = caseExportToHtml(buildCaseExport(kase, patient, { typeLabel: 'залежність + депресія' }));
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Олег, 35'));
  assert.ok(html.includes('Сесія 1') && html.includes('Сесія 2'));
  assert.ok(html.includes('Розкажіть детальніше'), 'транскрипт у HTML');
  assert.ok(html.includes('CTS-R (44/72)'));
  assert.ok(html.includes('опрацьовано ✓'), 'безпековий прапор');
  assert.ok(html.includes('Стабільна ремісія'));
});

test('caseExportToHtml: екранує HTML у даних (захист від інʼєкцій у транскрипті)', () => {
  const k = structuredClone(kase);
  const p = structuredClone(patient);
  p.records[0].dialogue.push({ type: 'you', text: '<script>alert(1)</script>' });
  const html = caseExportToHtml(buildCaseExport(k, p));
  assert.ok(!html.includes('<script>alert(1)</script>'), 'сирий скрипт не потрапляє в HTML');
  assert.ok(html.includes('&lt;script&gt;'), 'екрановано');
});
