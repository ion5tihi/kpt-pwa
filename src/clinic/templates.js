// templates.js — Бібліотека шаблонів кейсів (CaseTemplate) + прогресія складності 1–5.
// Реалізує ROADMAP T5.1 і DOMAIN_MODEL §CaseTemplate. Чистий модуль (без LLM/DOM).
//
// Шаблон — це АВТОРСЬКИЙ навчальний сценарій: фіксує тип розладу, стадію, налаштування
// конструктора (повзунки 0–5/0–3) і прицільний `initialStatePreset`, який уточнює стартовий
// ClinicalState після обчислення прийому. Складність 1–5 — це прогресія для стажера:
// від мотивованого пацієнта з міцним альянсом (1) до глухої стіни з ризиком зриву й
// випадання з терапії (5).
//
// ⚠️ КЛІНІЧНЕ ВРЯДУВАННЯ (SPEC §8): контент нижче — інженерна чернетка. Поля
// `clinicianReviewed: false` і `authoredBy: 'system-draft'` чесно це фіксують. Числа
// пресетів і сценарії потребують валідації клініцистом, перш ніж їх вважати еталонними.

import { intakeFromConstructor } from './intake.js';

export const TEMPLATES_VERSION = '1.0.0';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Людські назви рівнів складності (для UI). */
export const DIFFICULTY_LABELS = {
  1: 'Початковий',
  2: 'Базовий',
  3: 'Середній',
  4: 'Складний',
  5: 'Експертний'
};

// Допустимі діапазони полів ClinicalState для безпечного застосування пресету.
// Числові поля клемпуються; рядкові (coreBelief тощо) проходять як є.
const STATE_RANGES = {
  pacs: [0, 30], gad7: [0, 21], phq9: [0, 27],
  soberDays: [0, 3650], sleep: [0, 14],
  readiness: [0, 100], alliance: [0, 100], insight: [0, 100],
  selfEfficacy: [0, 100], resistance: [0, 100],
  relapseRisk: [0, 100], dropoutRisk: [0, 100],
  suicideRisk: [0, 3], homeworkAdherence: [0, 1]
};

const STRING_FIELDS = new Set(['coreBelief', 'hiddenFear', 'resistanceMechanism', 'primaryTrigger']);

/**
 * Застосувати `initialStatePreset` шаблону до обчисленого стану.
 * Числові поля клемпуються в межі шкали; рядкові поля перезаписуються, якщо задані.
 * Невідомі ключі ігноруються (захист від «тихих» помилок контенту).
 * @param {import('../engine/types').ClinicalState} state  базовий стан (не мутується)
 * @param {Partial<import('../engine/types').ClinicalState>} preset
 * @returns {import('../engine/types').ClinicalState} новий стан
 */
export function applyStatePreset(state, preset = {}) {
  const out = { ...state };
  for (const [key, val] of Object.entries(preset)) {
    if (val == null) continue;
    if (STATE_RANGES[key] && typeof val === 'number' && Number.isFinite(val)) {
      const [lo, hi] = STATE_RANGES[key];
      out[key] = key === 'homeworkAdherence' ? clamp(val, lo, hi) : Math.round(clamp(val, lo, hi));
    } else if (STRING_FIELDS.has(key) && typeof val === 'string') {
      out[key] = val;
    }
    // інші ключі свідомо ігноруємо
  }
  return out;
}

/**
 * @typedef {Object} CaseTemplate
 * @property {string} id
 * @property {string} title
 * @property {1|2|3|4|5} difficulty
 * @property {string} disorderType                 ключ TYPE_LABEL (api.js)
 * @property {string} stage                        етап лікування
 * @property {{resist:number,insight:number,open:number,risk:number}} constructorConfig
 * @property {Partial<import('../engine/types').ClinicalState>} initialStatePreset
 * @property {string[]} learningObjectives         які компетентності тренує
 * @property {string} clinicalBrief                наратив-сід для озвучення (LLM) + нотатка клініциста
 * @property {Partial<object>} [hiddenSeed]        підказка прихованої моделі (coreBelief/trigger/...)
 * @property {Array<object>} scriptedEvents        T5.2 (поки порожньо)
 * @property {string} authoredBy
 * @property {boolean} clinicianReviewed
 */

/** @type {CaseTemplate[]} */
export const CASE_TEMPLATES = [
  {
    id: 'alko-motivated-01',
    title: 'Перший крок',
    difficulty: 1,
    disorderType: 'alko',
    stage: 'рання реабілітація',
    constructorConfig: { resist: 1, insight: 4, open: 4, risk: 0 },
    initialStatePreset: {
      pacs: 14, phq9: 9, alliance: 60, readiness: 70, insight: 75,
      selfEfficacy: 45, resistance: 18, suicideRisk: 0,
      coreBelief: 'я сам вирішую, коли мені пити, просто зараз хочу взяти паузу',
      primaryTrigger: 'келих вина «за компанію» на сімейних вечерях'
    },
    learningObjectives: [
      'Побудова терапевтичного альянсу на старті',
      'Рефлективне слухання й точне відображення',
      'Узгодження порядку денного сесії (agenda setting)'
    ],
    clinicalBrief: 'Мотивований пацієнт середнього віку, який сам прийшов після кількох тривожних епізодів. ' +
      'Інсайт добрий, опір низький, ризику для безпеки немає. Завдання стажера — НЕ зіпсувати: ' +
      'утримувати темп пацієнта, не читати лекцій, закріпити альянс і спільно сформулювати ціль.',
    hiddenSeed: { resistanceMechanism: 'hollow-agreement', hiddenFear: 'страх, що «якщо визнаю проблему — значить я слабкий»' },
    scriptedEvents: [],
    authoredBy: 'system-draft',
    clinicianReviewed: false
  },
  {
    id: 'dual-dep-02',
    title: 'Подвійний тягар',
    difficulty: 2,
    disorderType: 'dual-dep',
    stage: 'рання реабілітація',
    constructorConfig: { resist: 2, insight: 3, open: 3, risk: 1 },
    initialStatePreset: {
      pacs: 17, phq9: 19, alliance: 50, readiness: 45, insight: 55,
      selfEfficacy: 30, resistance: 35, sleep: 4, suicideRisk: 0,
      coreBelief: 'без чарки ввечері я взагалі не засну і не витримаю цей тиск',
      hiddenFear: 'страх, що депресія — це назавжди і нічого вже не зміниться',
      primaryTrigger: 'самотні вечори після роботи, коли «нема сенсу»'
    },
    learningObjectives: [
      'Розпізнавання й валідація депресивного афекту',
      'Поведінкова активація як домашнє завдання',
      'Звʼязування вживання з регуляцією настрою (case formulation)'
    ],
    clinicalBrief: 'Подвійний діагноз: алкогольна залежність на тлі депресивного епізоду. Пацієнт втомлений, ' +
      'говорить тихо, легко зісковзує в безнадію. Помірний інсайт. Завдання — втримати баланс між роботою з ' +
      'настроєм і вживанням, не «лагодити» все одразу, ввести маленький конкретний крок активації.',
    hiddenSeed: { resistanceMechanism: 'tears' },
    scriptedEvents: [
      {
        atSession: 3,
        type: 'safety_crisis',
        riskLevel: 2,
        description: 'До 3-ї сесії депресія загострюється: пацієнт приходить із пасивними суїцидальними думками («краще б заснути й не прокидатися»). Прямо не скаже — стажер має делікатно запитати.',
        note: 'Навчальна ціль: депресивний ризик може зʼявитися ПІЗНІШЕ, навіть коли альянс начебто міцний. Не «розслаблятися» після кількох спокійних сесій.'
      }
    ],
    authoredBy: 'system-draft',
    clinicianReviewed: false
  },
  {
    id: 'stim-intellectual-03',
    title: 'Опір у кабінеті',
    difficulty: 3,
    disorderType: 'stim',
    stage: 'стабілізація',
    constructorConfig: { resist: 4, insight: 2, open: 2, risk: 1 },
    initialStatePreset: {
      pacs: 21, phq9: 12, alliance: 38, readiness: 30, insight: 35,
      selfEfficacy: 35, resistance: 78, suicideRisk: 0,
      coreBelief: 'я контролюю стимулятори, вони допомагають мені працювати на результат',
      hiddenFear: 'страх, що без речовини я виявлюся посереднім і нецікавим',
      primaryTrigger: 'дедлайни й нічна робота, де «треба бути на піку»'
    },
    learningObjectives: [
      'Робота з опором без конфронтації (roll with resistance)',
      'Уникання «пастки експерта» і суперечки',
      'Evocation: витягування власних аргументів пацієнта на зміну'
    ],
    clinicalBrief: 'Високофункціональний пацієнт зі стимуляторами, який інтелектуалізує й веде дискусію як дебати. ' +
      'Опір високий, інсайт низький, альянс крихкий. Якщо стажер починає переконувати — пацієнт виграє суперечку ' +
      'і альянс падає. Завдання — не сперечатися, відбивати амбівалентність, шукати власну мотивацію пацієнта.',
    hiddenSeed: { resistanceMechanism: 'intellectualisation' },
    scriptedEvents: [],
    authoredBy: 'system-draft',
    clinicianReviewed: false
  },
  {
    id: 'pure-dep-risk-04',
    title: 'Тиха криза',
    difficulty: 4,
    disorderType: 'pure-dep',
    stage: 'стабілізація',
    constructorConfig: { resist: 2, insight: 2, open: 1, risk: 2 },
    initialStatePreset: {
      pacs: 2, phq9: 23, gad7: 11, alliance: 45, readiness: 35,
      insight: 35, selfEfficacy: 20, resistance: 30, sleep: 3, suicideRisk: 2,
      coreBelief: 'я тягар для всіх, без мене їм було б легше',
      hiddenFear: 'страх, що біль ніколи не закінчиться',
      primaryTrigger: 'ранкові години й безсоння, коли думки найтемніші'
    },
    learningObjectives: [
      'Активний скринінг суїцидального ризику (PHQ-9 п.9)',
      'Не пропустити прихований сигнал за «затиснутістю»',
      'Базове безпекове планування й пряме чутливе запитання про ризик'
    ],
    clinicalBrief: 'Чиста депресія, пацієнт закритий і небагатослівний, але за фасадом — серйозний прихований ризик. ' +
      'Прямо про суїцид не скаже, поки терапевт делікатно не запитає. Це ключовий безпековий кейс: якщо стажер ' +
      'не проведе скринінг ризику й не відреагує — рушій активує safety-override і криза закриє випадок.',
    hiddenSeed: { resistanceMechanism: 'charm-as-avoidance' },
    scriptedEvents: [],
    authoredBy: 'system-draft',
    clinicianReviewed: false
  },
  {
    id: 'poly-wall-05',
    title: 'Глуха стіна',
    difficulty: 5,
    disorderType: 'poly',
    stage: 'профілактика рецидиву',
    constructorConfig: { resist: 5, insight: 1, open: 1, risk: 2 },
    initialStatePreset: {
      pacs: 26, phq9: 15, gad7: 12, alliance: 22, readiness: 18,
      insight: 18, selfEfficacy: 22, resistance: 92, relapseRisk: 55,
      dropoutRisk: 60, sleep: 4, suicideRisk: 0,
      coreBelief: 'ви всі однакові, ніхто мені реально не допоможе, я тут не з власної волі',
      hiddenFear: 'страх знову повірити й знову бути покинутим',
      primaryTrigger: 'старе оточення й відчуття, що «все одно зірвуся»'
    },
    learningObjectives: [
      'Утримання пацієнта в терапії при низькому альянсі (retention)',
      'MI у ворожих умовах: емпатія без капітуляції',
      'Робота зі зривом і амбівалентністю без сорому й моралізаторства'
    ],
    clinicalBrief: 'Полінаркоманія, профілактика рецидиву; пацієнта фактично «привели». Альянс на нулі, опір ' +
      'максимальний, високий ризик і зриву, і випадання з терапії. Будь-який тиск — і пацієнт іде. Завдання ' +
      'найвищого рівня: знизити загрозу, знайти бодай одну спільну точку, утримати в терапії до наступного разу.',
    hiddenSeed: { resistanceMechanism: 'aggression' },
    scriptedEvents: [
      {
        atSession: 2,
        type: 'relapse',
        severity: 0.85,
        description: 'Між 2-ю і 3-ю сесіями — зрив на старому оточенні (незалежно від якості роботи). Перевірка: як стажер працює зі зривом без сорому й моралізаторства, утримуючи пацієнта в терапії.',
        note: 'Навчальна ціль: зрив — частина процесу, а не провал терапевта. Реакція на зрив важливіша за сам зрив.'
      }
    ],
    authoredBy: 'system-draft',
    clinicianReviewed: false
  }
];

/** Знайти шаблон за id. @returns {CaseTemplate|null} */
export function getTemplate(id) {
  return CASE_TEMPLATES.find((t) => t.id === id) || null;
}

/**
 * Список шаблонів з опційним фільтром.
 * @param {{difficulty?:number, disorderType?:string}} [filter]
 * @returns {CaseTemplate[]}
 */
export function listTemplates(filter = {}) {
  return CASE_TEMPLATES.filter((t) =>
    (filter.difficulty == null || t.difficulty === filter.difficulty) &&
    (filter.disorderType == null || t.disorderType === filter.disorderType)
  );
}

/**
 * Шаблони, згруповані за складністю (для UI прогресії). Ключі 1..5, відсортовані.
 * @returns {Array<{difficulty:number, label:string, items:CaseTemplate[]}>}
 */
export function templatesByDifficulty() {
  const groups = new Map();
  for (const t of CASE_TEMPLATES) {
    if (!groups.has(t.difficulty)) groups.set(t.difficulty, []);
    groups.get(t.difficulty).push(t);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((d) => ({
    difficulty: d, label: DIFFICULTY_LABELS[d] || String(d), items: groups.get(d)
  }));
}

/**
 * Прийом із шаблону: будує {profile, initialState} як для конструктора, але застосовує
 * `initialStatePreset` і збагачує профіль метаданими шаблону. Те саме API-форму повертає,
 * що й intakeFromConstructor (+ поле `template`), тож виклична сторона взаємозамінна.
 * @param {CaseTemplate|string} template  обʼєкт шаблону або його id
 * @param {object|null} [hiddenState]     прихована модель від LLM (має пріоритет над пресетом)
 * @param {object} [opts] {displayName?, presentingComplaint?, createdAt?}
 * @returns {{profile:object, initialState:import('../engine/types').ClinicalState, template:CaseTemplate}}
 */
export function intakeFromTemplate(template, hiddenState = null, opts = {}) {
  const tmpl = typeof template === 'string' ? getTemplate(template) : template;
  if (!tmpl) throw new Error(`Невідомий шаблон кейсу: ${template}`);

  const config = {
    type: tmpl.disorderType,
    stage: tmpl.stage,
    mode: 'template',
    ...tmpl.constructorConfig
  };

  const base = intakeFromConstructor(config, hiddenState, {
    displayName: opts.displayName,
    presentingComplaint: opts.presentingComplaint,
    createdAt: opts.createdAt
  });

  // Пресет шаблону уточнює стан; але якщо LLM дав живий hiddenState — його рядкові поля
  // (coreBelief/trigger тощо) вже в base, тож НЕ перетираємо їх пресетними рядками.
  const preset = { ...tmpl.initialStatePreset };
  if (hiddenState) {
    for (const f of STRING_FIELDS) delete preset[f];
  }
  const initialState = applyStatePreset(base.initialState, preset);

  const profile = {
    ...base.profile,
    presentingComplaint: opts.presentingComplaint || base.profile.presentingComplaint || tmpl.title,
    templateId: tmpl.id,
    templateTitle: tmpl.title,
    difficulty: tmpl.difficulty
  };

  return { profile, initialState, template: tmpl };
}
