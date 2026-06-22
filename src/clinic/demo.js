// demo.js — Демонстрація петлі end-to-end без браузера.
// Симулює курс лікування: якість роботи терапевта зростає від сесії до сесії,
// рушій рахує реальну динаміку. Запуск: node src/clinic/demo.js

import { createCase, recordSessionOutcome, getTrajectory } from './case.js';

const profile = {
  id: 'p_demo', displayName: 'Олександр, 41', disorderType: 'alko',
  treatmentStage: 'рання реабілітація', presentingComplaint: 'тиск родини', createdAt: '2026-06-01'
};

const initialState = {
  pacs: 20, gad7: 13, phq9: 15, soberDays: 10, sleep: 4,
  readiness: 30, alliance: 42, insight: 20, selfEfficacy: 25, resistance: 55,
  relapseRisk: 0, dropoutRisk: 0, suicideRisk: 0, homeworkAdherence: 0.2,
  coreBelief: 'без алкоголю не впораюся зі стресом', hiddenFear: 'залишитися наодинці з думками',
  resistanceMechanism: 'intellectualisation', primaryTrigger: 'конфлікт з дружиною'
};

// CTS-R/MITI оцінка сесії за «рівнем майстерності» 0..1 (імітація реального ассесора)
function assessmentAt(skill, opts = {}) {
  const c = (lo, hi) => Math.round(lo + (hi - lo) * skill);
  const m = (lo, hi) => +(lo + (hi - lo) * skill).toFixed(1);
  return {
    ctsr: {
      agenda: c(2, 5), feedback: c(2, 5), collaboration: c(2, 6), pacing: c(2, 5),
      interpersonal: c(2, 6), guidedDiscovery: c(1, 5), conceptualization: c(2, 5),
      keyCognitions: c(1, 5), focusEmotion: c(2, 5), focusBehavior: c(2, 5),
      techniques: c(1, 5), homework: c(1, 5)
    },
    miti: {
      cultivatingChangeTalk: m(2, 5), softeningSustainTalk: m(2, 5),
      partnership: m(2, 5), empathy: m(2, 5),
      reflectionToQuestion: m(0.5, 2.2), complexReflectionPct: m(0.1, 0.55)
    },
    events: { safetyFlagPresent: false, safetyHandled: true, homeworkAssigned: skill > 0.4, ruptures: skill < 0.35 ? 2 : 0 },
    ctsrTotal: 0, narrative: '', strengths: [], growthAreas: [], durationTurns: 10
  };
}

const k = createCase({ profile, initialState, seed: 2026 });

// Терапевт «вчиться»: майстерність росте з кожною сесією
const skillBySession = [0.45, 0.55, 0.65, 0.75, 0.85, 0.92];

console.log(`\n  ВІРТУАЛЬНА КЛІНІКА — курс пацієнта «${profile.displayName}» (${profile.disorderType})\n`);
console.log('  сес | майст | PACS GAD PHQ | тверез | готовн альянс | ризикЗриву | подія');
console.log('  ----+-------+--------------+--------+--------------+------------+----------------');

const s0 = initialState;
console.log(`   S0 |   –   |  ${pad(s0.pacs)} ${pad(s0.gad7)}  ${pad(s0.phq9)} |   ${pad(s0.soberDays)}   |   ${pad(s0.readiness)}    ${pad(s0.alliance)}   |     –      | (прийом)`);

for (let i = 0; i < skillBySession.length && k.status === 'active'; i++) {
  const skill = skillBySession[i];
  const { result } = recordSessionOutcome(k, assessmentAt(skill), { date: `2026-06-${pad(8 + i * 7)}` });
  const st = k.state;
  const ev = result.events.map((e) => e.type).join(',') || '—';
  console.log(
    `   S${i + 1} |  ${skill.toFixed(2)} |  ${pad(st.pacs)} ${pad(st.gad7)}  ${pad(st.phq9)} |   ${pad(st.soberDays)}   |   ${pad(st.readiness)}    ${pad(st.alliance)}   |    ${pad(st.relapseRisk)}%    | ${ev}`
  );
}

console.log(`\n  Підсумок: статус = ${k.status.toUpperCase()}, сесій = ${k.sessions.length}` +
  (k.outcome ? `, виписка на сесії ${k.outcome.closedAtSession}` : '') + '\n');

if (k.outcome?.keyMoments?.length) {
  console.log('  Поворотні моменти:');
  for (const m of k.outcome.keyMoments) console.log(`   • сесія ${m.sessionIndex}: ${m.note}`);
  console.log('');
}

console.log('  Траєкторія (PACS / PHQ для графіка — РЕАЛЬНІ числа з рушія):');
console.log('   ' + getTrajectory(k).map((p) => `${p.pacs}/${p.phq9}`).join('  →  ') + '\n');

function pad(n) { return String(n).padStart(2, ' '); }
