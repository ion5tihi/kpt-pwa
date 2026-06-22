// params.js — Калібрувальні коефіцієнти симуляційного рушія.
// Усі «магічні числа» зібрані тут, щоб тюнити без зміни логіки (ENGINE.md §10).
// ⚠️ Стартові дефолти. Підлягають калібруванню на узгодженні з клініцистами (SPEC §8).

export const ENGINE_PARAMS = {
  // §4 Оновлення прихованого стану
  hidden: {
    allianceGain: 18, ruptureAlliancePenalty: 8, allianceDrift: 2,
    readinessEvoc: 16, readinessDisc: 4, ruptureReadiness: 6,
    insightDisc: 14, insightTech: 4,
    selfEffEvoc: 10, selfEffTech: 6, selfEffAll: 4,
    resAlliance: 12, resRupture: 10, resEvoc: 4
  },

  // §4 Виконання домашнього завдання (імовірність 0–1)
  homework: { base: 0.15, alliance: 0.40, readiness: 0.35, structure: 0.25 },

  // §5.1 Крейвінг (PACS)
  craving: { wReadiness: 0.45, wResist: 0.25, wTrigger: 0.30, wSober: 0.20, soberCap: 60, alpha: 0.5 },

  // §5.2 Тривога (GAD-7)
  anxiety: { gtrFloor: 9, baseFloor: 2, decay: 0.10, decayCap: 30, techEffect: 3, alpha: 0.5 },

  // §5.3 Депресія (PHQ-9)
  depress: { techEffect: 4, allianceEffect: 2, baEffect: 2, alpha: 0.4 },

  // §5.4 Сон
  sleep: { cravingEffect: 0.3, triggerEffect: 0.5 },

  // §6.2 Зрив (калібровано: крейвінг не домінує абсолютно; покращення готовності/тверезості
  // дає реальний шанс розірвати цикл зривів протягом курсу)
  relapse: {
    b0: -1.8, bCraving: 1.8, bReadiness: 1.6, bTrigger: 1.8, bHomework: 1.0, bSober: 1.4,
    soberCap: 90, cravingShock: 4, depressShock: 4
  },

  // §6.3 Відмова від лікування. ⚠️ ПРОВІЗОРНЕ калібрування (потребує підпису клініциста, G.2).
  // Контекст UA: пацієнт часто приходить ПІД ТИСКОМ (рідні/колектив), тож формально не кидає
  // лікування — він лишається й маніпулює (порожня згода, шарм). Тому: низька база (b0),
  // слабка залежність від опору (bResist↓: опір → маніпуляція, не втеча), головний важіль —
  // АЛЬЯНС (bAlliance: втрачаєш пацієнта, лише якщо взагалі не налагодив контакт).
  // Орієнтир: добра сесія ~6–12% відмови, погана ~25–37%, незалежно від рівня опору.
  dropout: { b0: -4.4, bResist: 1.0, bAlliance: 4.5, bSession: 0.3 },

  // §6.1 Подія життя (тригер)
  trigger: { pBase: 0.35, sevMin: 0.3, sevMax: 1.0 },

  // §7 Safety-override
  safety: { depressEscalation: 3, allianceBonus: 5 },

  // §8 Критерії виписки
  discharge: { minReadiness: 81, maxPacs: 10, maxPhq: 10, minSoberDays: 60, stableStreak: 3 }
};
