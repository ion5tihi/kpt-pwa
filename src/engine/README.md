# Симуляційний рушій

Детермінований рушій, що оновлює `ClinicalState` пацієнта між сесіями на основі
оцінки сесії. Реалізує [docs/ENGINE.md](../../docs/ENGINE.md). LLM сюди не звертається.

## Файли
- `params.js` — калібрувальні коефіцієнти (`ENGINE_PARAMS`).
- `engine.js` — чисті функції рушія.
- `engine.test.js` — 15 тестів (`node:test`, без залежностей).

## Запуск тестів
```bash
npm test
```

## Використання
```js
import { stepBetweenSessions } from './src/engine/engine.js';

const result = stepBetweenSessions({
  state,         // поточний ClinicalState
  initialState,  // S₀ на прийомі
  assessment,    // оцінка щойно завершеної сесії (CTS-R/MITI + events)
  context: { sessionIndex: 1, daysBetweenSessions: 7, comorbidityGAD: false, seed: 12345 }
});

result.nextState;        // ClinicalState на наступну сесію
result.events;           // [{type:'life_trigger'|'relapse'|'crisis', ...}]
result.status;           // 'active' | 'dropped_out' | 'crisis'
result.dischargeEligible;// чи готовий до виписки
result.debug;            // subScores, ймовірності, цілі — для UI/інтерпретації
```

## Експортовані чисті функції (для тестів/UI)
`computeSubScores`, `updateHidden`, `updateObservable`, `stepBetweenSessions`,
`normCtsr`, `normMiti`, `normRatio`, `normPct`, `clamp`, `clamp01`, `clamp100`, `sigmoid`.

## Детермінізм
Уся стохастика (тригер, зрив, dropout) — через seeded PRNG (mulberry32).
Однаковий `seed` + вхід → ідентичний вихід. `seed` логується разом із кейсом
для відтворюваності розбору/оцінювання.
