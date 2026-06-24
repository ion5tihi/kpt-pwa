# DOMAIN MODEL — КПТ-Клініка

> Сутності та типи. SSOT для структур даних. Підпорядковано [SPEC.md](SPEC.md).
> Нотація — TypeScript (як цільова мова після міграції на TS).

---

## Огляд сутностей

```
Trainee (стажер)
  └── Caseload
        └── Case (випадок)            1 пацієнт = 1 курс лікування
              ├── PatientProfile      статична картка (ім'я, діагноз, концептуалізація)
              ├── ClinicalState       поточний вектор стану (оновлює Engine)
              ├── Session[]           історія сесій
              │     ├── DialogueTurn[]  репліки
              │     ├── Assessment      оцінка CTS-R/MITI
              │     └── StateSnapshot   стан на момент сесії (для графіка)
              ├── BetweenEvent[]      події між сесіями (тригер, зрив, пропуск)
              └── Outcome?            результат курсу (якщо завершено)
TraineeProfile                        лонгітюдні метрики компетентності
CaseTemplate                          шаблон кейсу (бібліотека контенту)
```

---

## Типи

### ClinicalState — серце моделі
Розділяємо **спостережуване** (показуємо/пацієнт «повідомляє») і **приховане**
(керує поведінкою, рухається рушієм). Усі hidden-шкали 0–100 для одноманітності.

```ts
interface ClinicalState {
  // --- Спостережуване (на графіках) ---
  pacs: number;        // крейвінг 0–30
  gad7: number;        // тривога 0–21
  phq9: number;        // депресія 0–27
  soberDays: number;   // днів тверезості
  sleep: number;       // якість сну 0–10

  // --- Приховане (керує симуляцією та LLM-озвученням) ---
  readiness: number;       // готовність до змін 0–100 → стадія Прохаски
  alliance: number;        // терапевтичний альянс 0–100
  insight: number;         // усвідомлення проблеми 0–100
  selfEfficacy: number;    // віра у власну спроможність 0–100
  resistance: number;      // поточна захисність 0–100
  relapseRisk: number;     // обчислюваний ризик зриву 0–100
  dropoutRisk: number;     // ризик відмови від лікування 0–100
  suicideRisk: 0 | 1 | 2 | 3; // безпека (0 — немає, 3 — гострий)
  homeworkAdherence: number;  // 0–1, виконання ДЗ між сесіями

  // --- Якісне (для промпту LLM, не на графіках) ---
  coreBelief: string;            // глибинне переконання
  hiddenFear: string;            // прихований страх
  resistanceMechanism: ResistanceMechanism;
  primaryTrigger: string;        // ситуація високого ризику
}

type ResistanceMechanism =
  | 'intellectualisation' | 'charm-as-avoidance' | 'aggression'
  | 'hollow-agreement'    | 'tears'             | 'deflective-humour';
```

> **Стадії Прохаски з `readiness`:** 0–20 precontemplation · 21–40 contemplation
> · 41–60 preparation · 61–80 action · 81–100 maintenance.

### PatientProfile — статична картка випадку
```ts
interface PatientProfile {
  id: string;
  displayName: string;       // «Олександр, 41»
  disorderType: DisorderType;
  comorbidity?: string;
  treatmentStage: TreatmentStage;
  presentingComplaint: string;
  conceptualization?: string; // КПТ-концептуалізація (заповнюється з часом)
  createdAt: string;
}

type DisorderType =
  | 'alko' | 'opio' | 'stim' | 'sed' | 'poly' | 'gambl'
  | 'dual-dep' | 'dual-gtr' | 'dual-ptsr' | 'dual-panic'
  | 'pure-dep' | 'pure-ocd' | 'pure-phobia';

type TreatmentStage = 'детокс' | 'рання реабілітація' | 'стабілізація' | 'профілактика рецидиву';
```

### Case — випадок (курс лікування)
```ts
interface Case {
  id: string;
  schemaVersion: number;        // для міграцій
  profile: PatientProfile;
  state: ClinicalState;         // ПОТОЧНИЙ стан
  initialState: ClinicalState;  // S₀ на прийомі (для дельт)
  sessions: Session[];
  events: BetweenEvent[];
  status: CaseStatus;
  outcome?: Outcome;
  seed: number;                 // детермінізм стохастики (логується)
}

type CaseStatus = 'active' | 'discharged' | 'relapsed' | 'dropped_out' | 'crisis';
```

### Session
```ts
interface Session {
  id: string;
  caseId: string;
  index: number;                // № сесії (1-based)
  date: string;
  stateAtStart: ClinicalState;  // снапшот для графіка/відтворюваності
  turns: DialogueTurn[];
  assessment?: Assessment;      // з'являється після завершення
  durationTurns: number;
}

interface DialogueTurn {
  role: 'therapist' | 'patient';
  content: string;
  hint?: SupervisorHint;        // лише для реплік пацієнта
  ts: string;
}

interface SupervisorHint { now: string; avoid: string; do: string; example: string; }
```

### Assessment — оцінка сесії (вхід для рушія)
```ts
interface Assessment {
  ctsr: Record<CtsrItem, number>;   // 12 пунктів, 0–6
  ctsrTotal: number;                // /72
  miti: {
    cultivatingChangeTalk: number;  // 1–5
    softeningSustainTalk: number;   // 1–5
    partnership: number;            // 1–5
    empathy: number;                // 1–5
    reflectionToQuestion: number;   // ratio
    complexReflectionPct: number;   // 0–1
  };
  events: SessionEventFlags;
  subScores: SubCompetencyScores;   // обчислює Engine (§3 ENGINE.md)
  narrative: string;                // markdown-звіт супервізора
  strengths: string[];
  growthAreas: string[];
}

interface SessionEventFlags {
  safetyFlagPresent: boolean;       // у стані був ризик ≥2
  safetyHandled: boolean;           // терапевт оцінив ризик
  homeworkAssigned: boolean;
  ruptures: number;                 // MI-непослідовні ходи (конфронтація, поради без дозволу)
}

type CtsrItem =
  | 'agenda' | 'feedback' | 'collaboration' | 'pacing' | 'interpersonal'
  | 'guidedDiscovery' | 'conceptualization' | 'keyCognitions'
  | 'focusEmotion' | 'focusBehavior' | 'techniques' | 'homework';

interface SubCompetencyScores { // усі 0–1
  alliance: number; evocation: number; discovery: number;
  technique: number; structure: number;
}
```

### BetweenEvent / Outcome
```ts
interface BetweenEvent {
  caseId: string;
  afterSessionIndex: number;
  type: 'life_trigger' | 'relapse' | 'missed_session' | 'crisis' | 'improvement';
  severity: number;          // 0–1
  description: string;
  stateDelta: Partial<ClinicalState>; // що змінив рушій
}

interface Outcome {
  status: Exclude<CaseStatus, 'active'>;
  closedAtSession: number;
  summary: string;
  trajectory: StateSnapshotPoint[];
  keyMoments: { sessionIndex: number; note: string }[];
}
```

### ClinicEvent — інбокс подій клініки (T5.3)
```ts
interface ClinicEvent {
  id: string;
  type: 'missed_session' | 'urgent_intake';
  title: string; body: string;
  caseCode?: string;            // missed_session — кейс у caseload
  templateId?: string;          // urgent_intake — шаблон для нового Case
  options: { id: string; label: string; tone: 'primary'|'ghost'|'danger' }[];
  status: 'pending' | 'resolved';
  resolution?: string;
}
```
Генерація — детермінована (`src/clinic/inbox.js`): `missed_session` коли активний кейс має
`dropoutRisk ≥ 35`; `urgent_intake` коли звільняється слот (кейс закрито) — `pickUrgentTemplate`
обирає «гострий» шаблон. Наслідки `missed_session` — через `case.applyMissedSession`
(outreach: alliance↑/ризик↓; wait: alliance↓/ризик↑; discharge: закриває як `dropped_out`).
`urgent_intake.accept` → звичайний потік прийому з шаблону. Зберігається в `simulatorState.inbox`.

### TraineeProfile — лонгітюдна компетентність стажера
```ts
interface TraineeProfile {
  id: string;
  sessionsCompleted: number;
  casesCompleted: number;
  avgCtsr: number;
  ctsrTrend: number[];               // середній CTS-R по сесіях у часі
  reflectionRatioTrend: number[];
  complexReflectionTrend: number[];
  weakestCtsrItems: CtsrItem[];      // хронічно слабкі
  outcomesByStatus: Record<CaseStatus, number>;
  safetyResponses: { faced: number; handled: number };
}
```

### CaseTemplate — бібліотека контенту (валідовано клініцистом)
```ts
interface CaseTemplate {
  id: string;
  title: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  disorderType: DisorderType;
  stage: string;                     // етап лікування
  constructorConfig: { resist; insight; open; risk };  // повзунки 0–5/0–3 (наратив + прийом)
  initialStatePreset: Partial<ClinicalState>;
  learningObjectives: string[];      // які компетентності тренує
  clinicalBrief: string;             // наратив-сід для озвучення + нотатка клініциста
  scriptedEvents: ScriptedEvent[];   // напр. криза безпеки на сесії N (T5.2)
  authoredBy: string;
  clinicianReviewed: boolean;
}
```
Реалізація: `src/clinic/templates.js` (бібліотека + `intakeFromTemplate` + `applyStatePreset`).

### ScriptedEvent — авторська запланована подія (T5.2)
```ts
interface ScriptedEvent {
  atSession: number;                 // 1-based сесія, на якій спрацьовує
  type: 'safety_crisis' | 'life_trigger' | 'relapse';
  severity?: number;                 // 0..1 — для life_trigger/relapse
  riskLevel?: 2 | 3;                 // для safety_crisis (за замовч. 2)
  description?: string;              // наратив-сід (НЕ показується стажеру — це вправа)
  note?: string;                     // нотатка клініциста
}
```
Дві фази (`src/clinic/scripted.js`):
- **`safety_crisis`** — PRE-session: `beginSession()` піднімає `suicideRisk≥2` у стані кейса
  (для safety-override §7) і повертає `riskFlag` для прихованої моделі LLM. Стажер мусить
  провести скринінг; інакше — криза закриває випадок.
- **`life_trigger` / `relapse`** — рушій форсує подію в кроці між сесіями (`scriptedContext()`
  → override §6.1/§6.2). Порядок витягування rng не змінюється → детермінізм і форки збережено.

⚠️ Сценарії безпеки потребують валідації клініцистом (SPEC §8, G.3).

---

## Версіювання та міграції
- Кожен `Case` має `schemaVersion`. При завантаженні — прогнати через ланцюг
  міграцій `migrate(case, fromVersion → currentVersion)`.
- Міграції — чисті функції в окремому модулі `migrations/`, покриті тестами.
- **Заборонено** мовчазні фолбеки на дефолти при невідомій схемі — або міграція,
  або явна помилка з підказкою експорту.

## Зберігання
- **Клієнт**: IndexedDB (через Dexie) для кейсів і діалогів; `localStorage` лише
  для дрібних UI-налаштувань.
- **Бекенд**: профіль стажера, прогрес, бібліотека шаблонів, агрегати — у БД на сервері.
- Експорт/імпорт усього caseload у JSON (бекап).

## Зв'язок зі старою моделлю (legacy v3.0.1)
| Legacy | Нове |
|---|---|
| `patients[].records[]` (плутає клініку й тренажер) | `Case` (тренувальні) окремо від клінічних записів |
| фейкові `pacs/gad7/phq9` для практики | реальні значення з `ClinicalState`, рух рушієм |
| `simulatorState` (одна активна сесія) | `Case.sessions[]` + `Case.state` (безперервність) |
| `hiddenState` | `ClinicalState` (розширений, з alliance/readiness тощо) |
