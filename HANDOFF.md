# HANDOFF — поточний стан КПТ-Клініки

> Файл для наступної сесії. Читати разом із [CLAUDE.md](CLAUDE.md).
> SSOT лишається в `docs/` — тут лише **де ми зараз і що робити далі**.
> Оновлено: 2026-06-22.

## Одним абзацом
Іде міграція з legacy vanilla-JS PWA (файли в корені: `app.js`, `api.js`,
`storage.js`, `index.html`…) на модульну архітектуру в `src/`. **Доменне ядро
двох ключових фаз уже побудоване й протестоване** — лишилась інтеграція в UI.

## Що вже зроблено ✅
- **Симуляційний рушій (Фаза 2, ядро)** — `src/engine/`
  - `engine.js` — чисті детерміновані функції за [docs/ENGINE.md](docs/ENGINE.md)
    (суб-компетентності → hidden state → observable). LLM сюди не звертається.
  - `params.js` — калібрувальні коефіцієнти `ENGINE_PARAMS`.
  - Стохастика (тригери/зрив/dropout) через seeded PRNG (mulberry32) — відтворювано за `seed`.
  - Safety-override + штраф за пропущену кризу.
  - **15 тестів зелені** → `npm test`.
- **Лонгітюдний пацієнт (Фаза 1, ядро)** — `src/clinic/`
  - `case.js` — модель `Case` (`state` + `initialState` + `sessions[]`),
    безперервність стану, `getTrajectory()` повертає **справжні** числа з рушія.
  - `intake.js` — прийом: конфіг конструктора → стартовий `ClinicalState` + `PatientProfile`.
  - `assessment.js` — міст: сирий JSON оцінки → валідний `Assessment` для рушія.
  - **Тести:** case 6 + intake 8 + assessment 8.
  - Живий демо-прогін курсу: `node src/clinic/demo.js`.
- **Інтеграція в legacy-UI (T1.3/T1.4) ЗРОБЛЕНО** — `app.js`/`api.js`/`storage.js`:
  - Генерація пацієнта → створює `Case` (`intakeFromConstructor`), `storage.getCases/saveCases`.
  - Супервізія → `api.evaluateSessionStructured()` (JSON) → `buildAssessment` →
    `recordSessionOutcome` (рушій просуває стан) → Трекер пише **реальні** тотали →
    SVG-графік малює справжню траєкторію. Текстовий звіт супервізора лишився окремо.

- **Фаза 4 (профіль стажера) ЗРОБЛЕНО** — `src/clinic/profile.js`:
  - `buildTraineeProfile(cases)` — avgCTS-R, тренди, `weakestCtsrItems`, `mitiAverages`,
    `outcomesByStatus`, `safetyResponses`, `recommendations`; `buildCaseReport(kase)`.
  - **Дашборд** `renderDashboard` (панель `#dashboard-panel` у Тренажері): статистика,
    спарклайн CTS-R, найслабші пункти, MI-бари, безпека, «що тренувати далі».
  - **Звіт по випадку** `renderCaseReport` + модалка `#case-report-modal` (кнопка «Звіт» у кейслоаді).
- **Фаза 3 (безпечні зрізи) ЗРОБЛЕНО:**
  - T3.5 — промпти у `src/prompts/prompts.js` (`PROMPTS_VERSION` + builders), api.js делегує.
  - T3.4 — `src/net/fetchRetry.js` (timeout+retry), підключено в callOpenAI/callAnthropic.
  - T3.2 — OpenAI `json_schema` (strict, `assessmentJsonSchema()`) з фолбеком на `json_object`.

- **UX-фікси з живого тесту** (`app.js`/`index.html`/`style.css`):
  - Копі-кнопки біля кожної репліки + «⧉ Чат» (весь діалог) у хедері.
  - Банер «🗓 Прийом №N» + статус випадку вгорі чату (розрізнення сесій).
  - **Баг-фікс обліку**: на закритому випадку (криза/відмова/виписка) розмова більше
    НЕ зберігає фантомний запис у Трекер і чітко повідомляє «не зараховано». Раніше
    case.sessions і кількість записів Трекера розходились.
  - **Переробка чату**: медкартка → згортувана панель `#patient-card-bar` (не в стрічці);
    звіт CTS-R → компактний чип `.eval-chip` (відкриває модалку), а не гігантська бульбашка.
    Довжина стрічки ~удвічі менша.
  - **Згортувані панелі**: кейслоад і «Мій прогрес» згортаються кліком по заголовку
    (`data-collapse`, `setupCollapsiblePanels`), стан у `localStorage['kpt_collapsed']`.
  - **Калібрування dropout (G.2, ПРОВІЗОРНО)**: `ENGINE_PARAMS.dropout` = b0:-4.4, bResist:1.0,
    bAlliance:4.5. Контекст UA (пацієнт під тиском не тікає, а маніпулює): головний важіль —
    альянс, не опір. Добра сесія ~6–12% відмови, погана ~25–37%, незалежно від опору.
    Потребує підпису клініциста. ENGINE.md §6.3 оновлено.

- **T5.4 Deliberate practice ЗРОБЛЕНО**: `forkCaseFromSession(kase, atSession)` (`case.js`,
  +тести) відмотує випадок до сесії N (той самий `seed` → різниця лише у роботі терапевта).
  UI: кнопки «↻ з сесії N» у звіті по випадку → `loadForkIntoSimulator()` вантажить форк
  окремим випадком (новий ключ `code#xxxx`), жива повторна спроба. Введено `currentCaseCode()`
  (`simulatorState.activeCaseCode`) — ключ кейса відв'язано від імені пацієнта.
  Порівняння спроб — поки через окремі записи в кейслоаді/Трекері (накладений overlay-графік
  оригінал-vs-форк — можливе покращення).

## Що в роботі / найближчий крок 🟨
- **Перевірити в браузері з ключем** (єдина незакрита верифікація реального потоку):
  ЖИВА сесія (LLM) → супервізія → реальні числа + маркери + кейслоад + дашборд.
  Усі детерміновані шляхи й UI перевірені через інжект демо-даних + DOM-інспекцію.
- **Калібрування (G.2)** — ранній dropout надто агресивний: сильний терапевт часто
  «втрачає» пацієнта на 1-й сесії за багатьох seed (статус «виписка» важко відтворити).
  Перевірити `ENGINE_PARAMS.dropout` / стартовий alliance в `INTAKE_PARAMS`.
- **T3.3** (поділ моделей: дешева озвучення vs сильна супервізія) — потребує рішення
  по моделях + UI у Налаштуваннях; навмисно не робив автономно.
- **T3.1** (бекенд-проксі ключа) — відкладено: потребує інфра-рішень; ключ на клієнті
  поки прийнятний (тестовий). Anthropic tool use + стрімінг — теж потребують живого прогону.

## Деплой: GitHub Pages
Репо: **github.com/ion5tihi/kpt-pwa** (origin уже налаштовано в локальній теці; гілка `main`).
Деплой = `git add -A && git commit && git push` (Git Credential Manager закешував доступ —
пуш проходить без вікна). 2026-06-22 зроблено force-push повної модульної версії, що
замінила старий inline-моноліт. Live: `https://ion5tihi.github.io/kpt-pwa/`.
Застосунок хоститься на GitHub Pages (статика, відносні шляхи — працює під підкаталогом).
- **Service Worker = network-first** (`sw.js`): онлайн завжди свіжий код, кеш — офлайн-фолбек.
  ⚠️ Піднімай `CACHE_NAME` при кожному релізі (зараз `kpt-vct-v0.2.0`). Після деплою нового
  `sw.js` старий SW віддасть сторінку ще раз — потрібен один hard-refresh / перевідкриття PWA,
  далі оновлення застосовуються з одного reload.
- `.nojekyll` у корені — щоб Pages не проганяв Jekyll.
- ⚠️ Репозиторій ПУБЛІЧНИЙ: будь-хто з URL відкриє застосунок (зі своїм ключем). Ключ у коді
  відсутній (лише в localStorage браузера). Для тестового ключа ок; для широкого шарингу — T3.1.
- Пушити треба ВЕСЬ корінь разом із текою `src/` (модулі ядра), інакше імпорти 404.

## ⚠️ Гочá: кеш у preview
`serve` віддає файли без `Cache-Control` (лише ETag). Перший `location.reload()` після
правки інколи вантажить СТАРИЙ `app.js`/`index.html`; **другий reload** підхоплює новий.
При перевірці UI-змін у preview — перезавантажуй двічі або звіряй наявність нового коду.

Деталі й повний бектог: [docs/ROADMAP.md](docs/ROADMAP.md).

## Чого ще НЕ торкались ⬜
- **Фаза 0** (білд Vite+TS, Dexie-сховище, міграція з localStorage) — навмисно
  відкладена: ядро написане як ESM (JS+JSDoc), працює і в браузері, і в Node,
  у TS конвертується тривіально пізніше.
- **Фаза 3 решта** — T3.1 (бекенд-проксі), T3.3 (поділ моделей), стрімінг, Anthropic tool use.
- **Фаза 5** (бібліотека кейсів `CaseTemplate`, scripted-події, режим викладача, врядування).

## Як запустити
```bash
npm test                 # 64 тести (engine 15 + case 6 + intake 8 + assessment 10
                         #            + profile 10 + prompts 6 + fetchRetry 9)
node src/clinic/demo.js  # демо лонгітюдного курсу з реальною траєкторією
```
Legacy PWA відкривається як `index.html` (без білда).

## Орієнтир по файлах
| Шлях | Що це |
|---|---|
| `src/engine/engine.js` | рушій (чисті функції), серце Фази 2 |
| `src/engine/params.js` | калібрування `ENGINE_PARAMS` |
| `src/clinic/case.js` | модель `Case`, безперервність, `getTrajectory()` |
| `src/clinic/intake.js` | прийом: конструктор → `ClinicalState` + профіль (⚠️ калібрувати) |
| `src/clinic/assessment.js` | міст: JSON оцінки LLM → `Assessment`; `assessmentJsonSchema()` (T3.2) |
| `src/clinic/profile.js` | `buildTraineeProfile` + `buildCaseReport` (Фаза 4, чистий) |
| `src/prompts/prompts.js` | версіоновані промпти LLM (`PROMPTS_VERSION`, T3.5) |
| `src/net/fetchRetry.js` | `fetchWithRetry` (timeout+retry, T3.4) |
| `app.js` | контролер UI — Case + рушій + графік + кейслоад + дашборд + звіт |
| `api.js` | LLM-клієнт (делегує промпти; fetchRetry; json_schema). Ключ на клієнті — T3.1 |
| `storage.js` | localStorage; `getCases/saveCases` для симуляційних випадків |
| `docs/` | SSOT: SPEC / DOMAIN_MODEL / ENGINE / ARCHITECTURE / ROADMAP |

## Застереження
- ⚠️ `CLAUDE.md` → розділ «Поточний стан коду (legacy v3.0.1)» описує лише legacy
  й **не згадує** вже готове ядро в `src/` — варто оновити при нагоді.
- ⚠️ Ключ LLM зараз на клієнті (`api.js`) — це legacy-ризик, закривається в T3.1.
- Клінічна валідність > правдоподібність LLM: контент кейсів і `ENGINE_PARAMS`
  потребують калібрування клініцистом (SPEC §8 / G.1–G.3) перед реальним навчанням.
