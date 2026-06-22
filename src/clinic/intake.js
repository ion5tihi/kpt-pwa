// intake.js — Прийом: конструктор симулятора → стартовий ClinicalState (S₀) + PatientProfile.
// Чистий модуль (без LLM/DOM). Мапить шкали конструктора (0–5 / 0–3) у клінічні
// діапазони стану рушія. Реалізує DOMAIN_MODEL (ClinicalState/PatientProfile).
//
// ⚠️ КАЛІБРУВАННЯ: числові коефіцієнти нижче — інженерна першооцінка, що потребує
// валідації клініцистом (SPEC §8). Винесені в INTAKE_PARAMS, щоб легко калібрувати.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x, fallback) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const toInt = (x, fallback) => { const n = parseInt(x, 10); return Number.isFinite(n) ? n : fallback; };

// Класифікація типів розладу конструктора (api.js TYPE_LABEL).
const NON_ADDICTION = new Set(['pure-dep', 'pure-ocd', 'pure-phobia']);
const DEPRESSION = new Set(['dual-dep', 'pure-dep']);
const ANXIETY = new Set(['dual-gtr', 'dual-panic', 'dual-ptsr', 'pure-ocd', 'pure-phobia']);

export const INTAKE_PARAMS = {
  // Спостережуване — базові рівні залежно від профілю розладу
  pacs:  { addictionBase: 12, resistGain: 12, nonAddiction: 2 }, // 0–30
  phq9:  { depression: 16, addiction: 8, other: 6, riskGain: 2 }, // 0–27
  gad7:  { anxiety: 13, base: 6 },                                // 0–21
  sleep: 4,                                                       // годин/ніч (умовно)
  // Приховане
  resistance:   { perLevel: 20 },                  // resist 0–5 → 0–100
  readiness:    { base: 15, insightGain: 45, openGain: 15, resistDrop: 15 },
  insight:      { perLevel: 20 },                  // insight 0–5 → 0–100
  alliance:     { base: 45, openGain: 15, resistDrop: 15 },
  selfEfficacy: { base: 25, insightGain: 15 },
  homeworkAdherence: 0.3
};

/**
 * Побудувати стартовий стан і профіль пацієнта з конфіга конструктора симулятора.
 * @param {object} config  constructorConfig симулятора {type, stage, resist, insight, open, risk}
 * @param {object} [hiddenState] прихована модель від LLM {coreBelief, hiddenFear, resistanceMechanism, trigger, resistanceLevel, riskFlag}
 * @param {object} [opts] {displayName?, presentingComplaint?, createdAt?}
 * @returns {{profile: import('../engine/types').PatientProfile, initialState: import('../engine/types').ClinicalState}}
 */
export function intakeFromConstructor(config = {}, hiddenState = null, opts = {}) {
  const P = INTAKE_PARAMS;
  const type = config.type || 'alko';
  const isAddiction = !NON_ADDICTION.has(type);
  const hasDepression = DEPRESSION.has(type);
  const hasAnxiety = ANXIETY.has(type);

  // hiddenState має пріоритет над повзунками (узгоджено з legacy app.js).
  const resist = clamp(toInt(hiddenState?.resistanceLevel, toInt(config.resist, 3)), 0, 5);
  const risk = clamp(toInt(hiddenState?.riskFlag, toInt(config.risk, 0)), 0, 3);
  const insight = clamp(toInt(config.insight, 2), 0, 5);
  const open = clamp(toInt(config.open, 2), 0, 5);

  const f5 = (n) => n / 5; // частка від максимуму повзунка

  const pacs = isAddiction
    ? clamp(P.pacs.addictionBase + f5(resist) * P.pacs.resistGain, 0, 30)
    : P.pacs.nonAddiction;
  const phq9 = clamp((hasDepression ? P.phq9.depression : isAddiction ? P.phq9.addiction : P.phq9.other)
    + risk * P.phq9.riskGain, 0, 27);
  const gad7 = clamp(hasAnxiety ? P.gad7.anxiety : P.gad7.base, 0, 21);

  const resistance = clamp(resist * P.resistance.perLevel, 0, 100);
  const readiness = clamp(P.readiness.base + f5(insight) * P.readiness.insightGain
    + f5(open) * P.readiness.openGain - f5(resist) * P.readiness.resistDrop, 0, 100);
  const insightState = clamp(insight * P.insight.perLevel, 0, 100);
  const alliance = clamp(P.alliance.base + f5(open) * P.alliance.openGain - f5(resist) * P.alliance.resistDrop, 0, 100);
  const selfEfficacy = clamp(P.selfEfficacy.base + f5(insight) * P.selfEfficacy.insightGain, 0, 100);

  /** @type {import('../engine/types').ClinicalState} */
  const initialState = {
    // спостережуване
    pacs: Math.round(pacs), gad7: Math.round(gad7), phq9: Math.round(phq9),
    soberDays: 0, sleep: P.sleep,
    // приховане
    readiness: Math.round(readiness),
    alliance: Math.round(alliance),
    insight: Math.round(insightState),
    selfEfficacy: Math.round(selfEfficacy),
    resistance: Math.round(resistance),
    relapseRisk: 0, dropoutRisk: 0,
    suicideRisk: risk >= 2 ? 2 : 0,  // ризик ≥2 вмикає safety-логіку рушія (ENGINE §7)
    homeworkAdherence: P.homeworkAdherence,
    // якісне
    coreBelief: hiddenState?.coreBelief || '',
    hiddenFear: hiddenState?.hiddenFear || '',
    resistanceMechanism: hiddenState?.resistanceMechanism || 'intellectualisation',
    primaryTrigger: hiddenState?.trigger || ''
  };

  /** @type {import('../engine/types').PatientProfile} */
  const profile = {
    id: 'p_' + Math.random().toString(36).slice(2, 10),
    displayName: opts.displayName || 'Віртуальний пацієнт',
    disorderType: type,                          // напр. 'dual-gtr' → рушій додає коморбідний ГТР
    treatmentStage: config.stage || 'рання реабілітація',
    presentingComplaint: opts.presentingComplaint || '',
    createdAt: opts.createdAt || new Date().toISOString()
  };

  return { profile, initialState };
}
