// engine.js — Симуляційний рушій віртуальної клініки.
// Детерміновано оновлює ClinicalState між сесіями на основі оцінки сесії.
// Реалізує ENGINE.md. LLM сюди не звертається — лише чиста математика.
//
// Контракт типів — у docs/DOMAIN_MODEL.md (ClinicalState, Assessment).

import { ENGINE_PARAMS } from './params.js';

// ---------------------------------------------------------------------------
// Дрібні чисті помічники
// ---------------------------------------------------------------------------
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const clamp01 = (x) => clamp(x, 0, 1);
export const clamp100 = (x) => clamp(x, 0, 100);
export const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const mean = (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = Math.round;
const round1 = (x) => Math.round(x * 10) / 10;

// Детермінований PRNG (mulberry32). Однаковий seed → однакова послідовність.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedMix = (seed, sessionIndex) => (seed ^ Math.imul(sessionIndex, 2654435761)) >>> 0;

// ---------------------------------------------------------------------------
// §2 Нормалізація оцінки (0–1)
// ---------------------------------------------------------------------------
export const normCtsr = (item) => clamp01(item / 6);          // CTS-R пункт 0–6
export const normMiti = (g) => clamp01((g - 1) / 4);          // MITI глобал 1–5
export const normRatio = (ratio) => clamp01(ratio / 2);        // reflection:question, ціль ≥2
export const normPct = (pct) => clamp01(pct / 0.5);            // % складних рефлексій, ціль ≥50%

// ---------------------------------------------------------------------------
// §3 Суб-компетентності (кожна 0–1)
// ---------------------------------------------------------------------------
/** @param {import('./types').Assessment} a */
export function computeSubScores(a) {
  const c = a.ctsr, m = a.miti;
  return {
    alliance: mean(normCtsr(c.feedback), normCtsr(c.collaboration), normCtsr(c.interpersonal),
                   normMiti(m.partnership), normMiti(m.empathy)),
    evocation: mean(normMiti(m.cultivatingChangeTalk), normMiti(m.softeningSustainTalk),
                    normRatio(m.reflectionToQuestion), normPct(m.complexReflectionPct)),
    discovery: mean(normCtsr(c.guidedDiscovery), normCtsr(c.keyCognitions)),
    technique: mean(normCtsr(c.techniques), normCtsr(c.conceptualization)),
    structure: mean(normCtsr(c.agenda), normCtsr(c.pacing), normCtsr(c.homework))
  };
}

// ---------------------------------------------------------------------------
// §4 Оновлення прихованого стану
// ---------------------------------------------------------------------------
export function updateHidden(state, sub, ruptures, homeworkAssigned, params = ENGINE_PARAMS) {
  const h = params.hidden;
  const { alliance: A, evocation: E, discovery: D, technique: T, structure: S } = sub;
  const R = ruptures;
  const driftA = R === 0 ? h.allianceDrift : 0;

  const alliance = clamp100(state.alliance + h.allianceGain * (A - 0.5) - h.ruptureAlliancePenalty * R + driftA);
  const readiness = clamp100(state.readiness + h.readinessEvoc * (E - 0.5) + h.readinessDisc * (D - 0.5) - h.ruptureReadiness * R);
  const insight = clamp100(state.insight + h.insightDisc * (D - 0.5) + h.insightTech * (T - 0.5));
  const selfEfficacy = clamp100(state.selfEfficacy + h.selfEffEvoc * (E - 0.5) + h.selfEffTech * (T - 0.5) + h.selfEffAll * (A - 0.5));
  const resistance = clamp100(state.resistance - h.resAlliance * (A - 0.5) + h.resRupture * R - h.resEvoc * (E - 0.5));

  const hw = params.homework;
  const homeworkAdherence = homeworkAssigned
    ? clamp01(hw.base + hw.alliance * (alliance / 100) + hw.readiness * (readiness / 100) + hw.structure * (S - 0.5) * 2)
    : 0;

  return { alliance, readiness, insight, selfEfficacy, resistance, homeworkAdherence };
}

// ---------------------------------------------------------------------------
// §5 Оновлення спостережуваного стану (target + релаксація)
// Повертає також targets — для тестів та інтерпретації.
// ---------------------------------------------------------------------------
export function updateObservable(state, initialState, hidden, sub, ctx, triggerSeverity, params = ENGINE_PARAMS) {
  const P = params;

  // §5.1 Крейвінг
  const cv = P.craving;
  const pressure = cv.wReadiness * (100 - hidden.readiness) / 100
                 + cv.wResist * hidden.resistance / 100
                 + cv.wTrigger * triggerSeverity
                 - cv.wSober * Math.min(state.soberDays, cv.soberCap) / cv.soberCap;
  const pacsTarget = clamp(30 * clamp01(pressure), 0, 30);
  const pacs = round(state.pacs + cv.alpha * (pacsTarget - state.pacs));

  // §5.2 Тривога
  const ax = P.anxiety;
  const floor = ctx.comorbidityGAD ? ax.gtrFloor : ax.baseFloor;
  const abstDecay = ax.decay * Math.min(state.soberDays, ax.decayCap);
  const gadTarget = clamp(floor + (initialState.gad7 - floor) * Math.exp(-abstDecay) - ax.techEffect * (sub.technique - 0.5), 0, 21);
  const gad7 = round(state.gad7 + ax.alpha * (gadTarget - state.gad7));

  // §5.3 Депресія
  const dp = P.depress;
  const baBonus = (ctx.behavioralActivation && hidden.homeworkAdherence >= 0.5) ? dp.baEffect : 0;
  const phqTarget = clamp(state.phq9 - dp.techEffect * (sub.technique - 0.5) - dp.allianceEffect * (hidden.alliance / 100 - 0.5) - baBonus, 0, 27);
  const phq9 = round(state.phq9 + dp.alpha * (phqTarget - state.phq9));

  // §5.4 Сон
  const sl = P.sleep;
  const sleep = round1(clamp(state.sleep + sl.cravingEffect * (1 - pacs / 30) * 2 - sl.triggerEffect * triggerSeverity, 0, 10));

  return { pacs, gad7, phq9, sleep, targets: { pacs: pacsTarget, gad7: gadTarget, phq9: phqTarget } };
}

// ---------------------------------------------------------------------------
// Головна функція: крок між сесіями (§1 пайплайн)
// ---------------------------------------------------------------------------
/**
 * @param {object} args
 * @param {import('./types').ClinicalState} args.state         поточний стан
 * @param {import('./types').ClinicalState} args.initialState  стан на прийомі (S₀)
 * @param {import('./types').Assessment}    args.assessment    оцінка щойно завершеної сесії
 * @param {object} args.context  { sessionIndex, daysBetweenSessions?, comorbidityGAD?, behavioralActivation?, seed }
 * @param {object} [params]
 */
export function stepBetweenSessions({ state, initialState, assessment, context }, params = ENGINE_PARAMS) {
  const ctx = { daysBetweenSessions: 7, comorbidityGAD: false, behavioralActivation: false, ...context };
  const ev = assessment.events || {};
  const ruptures = ev.ruptures || 0;
  const events = [];

  // Детерміновані випадкові числа (фіксований порядок витягування)
  const rng = mulberry32(seedMix(ctx.seed >>> 0, ctx.sessionIndex | 0));
  const rTrig = rng(), rSev = rng(), rRelapse = rng(), rDrop = rng();

  // §6.1 Подія життя (тригер)
  const tg = params.trigger;
  const triggered = rTrig < tg.pBase;
  const triggerSeverity = triggered ? tg.sevMin + rSev * (tg.sevMax - tg.sevMin) : 0;
  if (triggered) {
    events.push({ type: 'life_trigger', severity: round1(triggerSeverity), description: '' });
  }

  // §3–§4 Суб-компетентності та прихований стан
  const sub = computeSubScores(assessment);
  const hidden = updateHidden(state, sub, ruptures, !!ev.homeworkAssigned, params);

  // §5 Спостережуваний стан
  const obs = updateObservable(state, initialState, hidden, sub, ctx, triggerSeverity, params);
  let { pacs, gad7, phq9, sleep } = obs;

  // §6.2 Зрив
  const rl = params.relapse;
  const zRelapse = rl.b0
    + rl.bCraving * (pacs / 30)
    + rl.bReadiness * (1 - hidden.readiness / 100)
    + rl.bTrigger * triggerSeverity
    + rl.bHomework * (1 - hidden.homeworkAdherence)
    - rl.bSober * Math.min(state.soberDays, rl.soberCap) / rl.soberCap;
  const pRelapse = sigmoid(zRelapse);
  const relapse = rRelapse < pRelapse;
  let soberDays;
  if (relapse) {
    pacs = clamp(pacs + rl.cravingShock, 0, 30);
    phq9 = clamp(phq9 + rl.depressShock, 0, 27);
    soberDays = 0;
    events.push({ type: 'relapse', severity: round1(triggerSeverity), description: '' });
  } else {
    soberDays = state.soberDays + ctx.daysBetweenSessions;
  }

  // §6.3 Відмова від лікування
  const dr = params.dropout;
  const zDrop = dr.b0 + dr.bResist * (hidden.resistance / 100) + dr.bAlliance * (1 - hidden.alliance / 100) - dr.bSession * ctx.sessionIndex;
  const pDropout = sigmoid(zDrop);
  const dropout = rDrop < pDropout;

  // §7 Safety-override
  let alliance = hidden.alliance;
  let suicideRisk = state.suicideRisk;
  let crisis = false;
  const safetyFlag = state.suicideRisk >= 2;
  if (safetyFlag && !ev.safetyHandled) {
    phq9 = clamp(phq9 + params.safety.depressEscalation, 0, 27);
    suicideRisk = Math.min(3, state.suicideRisk + 1);
    crisis = true;
    events.push({ type: 'crisis', severity: 1, description: 'Пропущено сигнал ризику безпеки.' });
  } else if (safetyFlag && ev.safetyHandled) {
    alliance = clamp100(alliance + params.safety.allianceBonus);
    suicideRisk = Math.max(0, state.suicideRisk - 1);
  }

  // Статус курсу
  let status = 'active';
  if (crisis) status = 'crisis';
  else if (dropout) status = 'dropped_out';

  const dischargeEligible = status === 'active'
    && hidden.readiness >= params.discharge.minReadiness
    && pacs <= params.discharge.maxPacs
    && phq9 <= params.discharge.maxPhq
    && soberDays >= params.discharge.minSoberDays;

  /** @type {import('./types').ClinicalState} */
  const nextState = {
    // спостережуване
    pacs, gad7, phq9, soberDays, sleep,
    // приховане
    readiness: hidden.readiness,
    alliance,
    insight: hidden.insight,
    selfEfficacy: hidden.selfEfficacy,
    resistance: hidden.resistance,
    relapseRisk: round(pRelapse * 100),
    dropoutRisk: round(pDropout * 100),
    suicideRisk,
    homeworkAdherence: hidden.homeworkAdherence,
    // якісне — переноситься без змін
    coreBelief: state.coreBelief,
    hiddenFear: state.hiddenFear,
    resistanceMechanism: state.resistanceMechanism,
    primaryTrigger: state.primaryTrigger
  };

  return {
    nextState,
    events,
    status,
    dischargeEligible,
    debug: { subScores: sub, triggerSeverity, pRelapse, pDropout, relapse, dropout, crisis, targets: obs.targets }
  };
}
