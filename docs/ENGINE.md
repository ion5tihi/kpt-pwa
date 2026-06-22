# ENGINE — Симуляційний рушій

> Як оцінка сесії (CTS-R/MITI) перетворюється на зміну стану пацієнта.
> Це інтелектуальне ядро тренажера. Підпорядковано [SPEC.md](SPEC.md);
> типи — у [DOMAIN_MODEL.md](DOMAIN_MODEL.md).

> ⚠️ **Усі коефіцієнти нижче — стартові дефолти.** Вони підлягають калібруванню
> на узгодженні з клініцистами (SPEC §8). Тримати їх в одному конфізі `ENGINE_PARAMS`,
> щоб тюнити без зміни логіки.

---

## 0. Принципи

1. **LLM не рахує числа.** Рушій — детермінований (стохастика лише через явний
   `seed`, що логується). Той самий вхід → той самий напрям результату.
2. **Розділення «озвучення / рішення».** LLM читає `ClinicalState` і відіграє його.
   Рушій змінює `ClinicalState` між сесіями.
3. **Target + релаксація.** Спостережувані шкали не стрибають: вони рухаються до
   цільового значення, що диктує прихований стан: `X′ = X + α·(X_target − X) + shock`.
4. **Компетентність → напрям.** Робота вище середньої покращує стан, нижче —
   погіршує. Тому ефект рахуємо від центру: `(score − 0.5)`.

---

## 1. Пайплайн (між сесією t і t+1)

```
Assessment(t)
   │  §2 нормалізація → §3 суб-компетентності
   ▼
ΔHidden  (readiness, alliance, insight, selfEfficacy, resistance)   §4
   ▼
ΔObservable (pacs, gad7, phq9, sleep, soberDays) через target+релаксація  §5
   ▼
Стохастика: подія життя → зрив? → dropout?    §6
   ▼
Safety-override (непомічена криза)             §7
   ▼
ClinicalState(t+1)  +  BetweenEvent[]  +  можливий Outcome
```

---

## 2. Нормалізація оцінки (0–1)
- CTS-R пункт (0–6): `n = item / 6`.
- MITI глобал (1–5): `n = (g − 1) / 4`.
- Reflection:Question ratio (ціль ≥2): `n = clamp(ratio / 2, 0, 1)`.
- % складних рефлексій (ціль ≥50%): `n = clamp(pct / 0.5, 0, 1)`.
- `ruptures` — лічильник MI-непослідовних ходів (не нормалізується, входить штрафом).

## 3. Суб-компетентності
Різні навички рухають різні змінні. Кожна суб-оцінка — зважене середнє (0–1):

| Суб-оцінка | Складники (нормалізовані) |
|---|---|
| **alliance** | CTS-R: feedback, collaboration, interpersonal · MITI: partnership, empathy |
| **evocation** (MI) | MITI: cultivatingChangeTalk, softeningSustainTalk, reflection:question, %complex |
| **discovery** | CTS-R: guidedDiscovery, keyCognitions |
| **technique** | CTS-R: techniques, conceptualization |
| **structure** | CTS-R: agenda, pacing, homework |

```
alliance  = mean(feedback, collaboration, interpersonal, partnership, empathy)
evocation = mean(cultivatingCT, softeningST, refQratio_n, complexPct_n)
discovery = mean(guidedDiscovery, keyCognitions)
technique = mean(techniques, conceptualization)
structure = mean(agenda, pacing, homework)
```

## 4. Оновлення прихованого стану
`clamp(x) = min(100, max(0, x))`. `A,E,D,T,S` — суб-оцінки §3, `R` — ruptures.

```
alliance′    = clamp( alliance    + 18·(A − 0.5) − 8·R + driftA )
readiness′   = clamp( readiness   + 16·(E − 0.5) + 4·(D − 0.5) − 6·R )
insight′     = clamp( insight     + 14·(D − 0.5) + 4·(T − 0.5) )
selfEfficacy′= clamp( selfEfficacy+ 10·(E − 0.5) + 6·(T − 0.5) + 4·(A − 0.5) )
resistance′  = clamp( resistance  − 12·(A − 0.5) + 10·R − 4·(E − 0.5) )
```

`driftA` — невеликий природний приріст альянсу за сам факт продовження терапії (напр. +2),
якщо не було розривів.

**homeworkAdherence (на наступний інтервал)** — імовірність виконати ДЗ:
```
homeworkAdherence′ = clamp01( 0.15 + 0.40·(alliance′/100) + 0.35·(readiness′/100) + 0.25·(S − 0.5)·2 )
```
(якщо `homeworkAssigned = false` → 0; відсутність ДЗ також знижує structure-ефект).

## 5. Оновлення спостережуваного стану

### 5.1 Крейвінг (PACS, 0–30)
Цільовий крейвінг — «тиск» від прихованого стану й стресу:
```
cravingPressure = 0.45·(100 − readiness)/100
                + 0.25·(resistance)/100
                + 0.30·triggerSeverity            // §6, 0–1
                − 0.20·min(soberDays, 60)/60       // стабільність тверезості
pacs_target = clamp30( 30 · clamp01(cravingPressure) )
pacs′       = round( pacs + 0.5·(pacs_target − pacs) )   // релаксація α=0.5
```

### 5.2 Тривога (GAD-7, 0–21)
Розрізняємо **абстинентну** тривогу (минає з тверезістю) і **коморбідний ГТР** (має підлогу):
```
gadFloor   = isGAD(comorbidity) ? 9 : 2          // ГТР не падає нижче порогу
abstDecay  = 0.10 · min(soberDays, 30)           // абстинентна тривога згасає
gad_target = clamp21( gadFloor + (initial.gad7 − gadFloor)·exp(−abstDecay)
                       − 3·(technique − 0.5) )    // техніки знижують
gad7′      = round( gad7 + 0.5·(gad_target − gad7) )
```

### 5.3 Депресія (PHQ-9, 0–27)
Депресія без втручання **персистує**; знижується від техніки + альянсу + поведінкової активації:
```
phq_target = clamp27( phq9
              − 4·(technique − 0.5)
              − 2·(alliance/100 − 0.5)
              − behavioralActivationBonus )        // якщо ДЗ на активацію виконано → −2
phq9′      = round( phq9 + 0.4·(phq_target − phq9) )
```

### 5.4 Сон і дні тверезості
```
sleep′     = clamp10( sleep + 0.3·(1 − pacs′/30)·2 − 0.5·triggerSeverity )
soberDays′ = relapse ? 0 : soberDays + daysBetweenSessions   // §6
```

## 6. Стохастика (детермінована через seed)

### 6.1 Подія життя (тригер)
З імовірністю `pTrigger` (база 0.35, ↑ зі стресовістю кейсу) генерується тригер
із `triggerSeverity ∈ [0.3, 1.0]`. Опис бере LLM, але **число — рушій**.

### 6.2 Зрив (relapse)
```
z = −1.8 + 1.8·(pacs/30) + 1.6·(1 − readiness/100)
        + 1.8·triggerSeverity + 1.0·(1 − homeworkAdherence)
        − 1.4·min(soberDays,90)/90
pRelapse = sigmoid(z)
relapse  = rng(seed) < pRelapse
```
Наслідки зриву: `soberDays=0`, `pacs += 4`, `phq9 += 4`, `readiness ±` (криза може
**підняти** готовність, якщо терапевт добре опрацював), `alliance` залежить від
реакції на наступній сесії. Створюється `BetweenEvent{type:'relapse'}`.

### 6.3 Відмова від лікування (dropout)
```
z = −4.4 + 1.0·(resistance/100) + 4.5·(1 − alliance/100) − 0.3·sessionIndex
pDropout = sigmoid(z)
```
> ⚠️ ПРОВІЗОРНЕ калібрування (потребує підпису клініциста, G.2). Контекст України:
> пацієнт часто приходить **під тиском** (рідні/колектив), тож формально лікування не кидає —
> він лишається й **маніпулює** (порожня згода, шарм). Тому головний важіль відмови — **альянс**
> (`bAlliance`), а не опір (`bResist` навмисно низький: опір виходить через маніпуляції й
> відсутність прогресу, а не через втечу). Орієнтир: добра сесія ~6–12% відмови за сесію,
> погана ~25–37%, майже незалежно від рівня опору.
`sessionIndex` у формулі дає «звикання»: що довше тримається в терапії, то нижчий
ризим зникнути. Спрацювання → `status='dropped_out'`, курс закривається.

## 7. Safety-override (навчальний жорсткий стоп)
Якщо `suicideRisk ≥ 2` **і** `safetyHandled = false`:
- ескалація: `suicideRisk` не падає (може зрости до 3), `phq9 += 3`;
- `BetweenEvent{type:'crisis'}`, можливий `status='crisis'`;
- в `Assessment` — **жорсткий штраф** і явне попередження в narrative;
- це навмисний педагогічний механізм: пропущена криза має «боліти».

Якщо `safetyHandled = true` при ризику → бонус до alliance і до оцінки безпеки.

## 8. Стадія Прохаски з readiness
0–20 precontemplation · 21–40 contemplation · 41–60 preparation · 61–80 action ·
81–100 maintenance. Виписка (`discharged`) можлива з maintenance при стабільних
показниках (pacs<10, phq9<10, soberDays високі) кілька сесій поспіль.

---

## 9. Worked example (одна ітерація)

> ⚠️ Цей приклад ілюструє **механіку** з початковими коефіцієнтами relapse
> (`b0=−1.2`, `bCraving=2.4`). Після калібрування (§6.2/§10) числа `pRelapse` нижчі —
> SSOT коефіцієнтів — це §10 і `src/engine/params.js`.

**Стан t:** pacs=20, gad7=12, phq9=14, soberDays=14, readiness=35, alliance=40,
resistance=55, comorbidity=none, homeworkAssigned=true.
**Сесія:** добре MI. A=0.7, E=0.75, D=0.6, T=0.55, S=0.5, R=0 (без розривів).

**Hidden:**
- alliance′ = 40 + 18·0.2 − 0 + 2 = **45.6**
- readiness′ = 35 + 16·0.25 + 4·0.1 = **39.4**
- resistance′ = 55 − 12·0.2 + 0 − 4·0.25 = **51.6**
- homeworkAdherence′ ≈ 0.15 + 0.40·0.456 + 0.35·0.394 + 0.25·0 = **0.47**

**Observable (припустимо triggerSeverity=0.2):**
- cravingPressure = 0.45·0.606 + 0.25·0.516 + 0.30·0.2 − 0.20·(14/60)
  = 0.273 + 0.129 + 0.06 − 0.047 = 0.415 → pacs_target ≈ 12.4
  → pacs′ = 20 + 0.5·(12.4−20) = **16.2**
- gad_target = 2 + (12−2)·e^(−0.10·14) − 3·0.05 = 2 + 10·0.247 − 0.15 = 4.32
  → gad7′ = 12 + 0.5·(4.32−12) = **8.2**
- phq_target = 14 − 4·0.05 − 2·(−0.046) − 0 = 13.9 → phq9′ = 14 + 0.4·(−0.1) ≈ **14.0**

**Зрив?** z = −1.2 + 2.4·0.54 + 1.6·0.606 + 1.8·0.2 + 1.0·0.53 − 1.4·0.156
= −1.2 +1.30 +0.97 +0.36 +0.53 −0.22 = 1.74 → pRelapse = sigmoid(1.74) ≈ 0.85 ⚠️

> Інтерпретація: хоча сесія була хороша, **готовність ще низька, крейвінг високий,
> тверезість крихка** — ризик зриву великий. Це і є цінний урок: одна добра сесія не
> рятує; depression-показник майже не рухається без прицільної роботи; терапевту
> варто прицільно зайнятись профілактикою зриву та поведінковою активацією.

---

## 10. Конфіг параметрів (тюнінг)
Усі магічні числа — в одному об'єкті:
```ts
export const ENGINE_PARAMS = {
  hidden: { allianceGain:18, ruptureAlliancePenalty:8, allianceDrift:2,
            readinessEvoc:16, readinessDisc:4, ruptureReadiness:6,
            insightDisc:14, insightTech:4,
            selfEffEvoc:10, selfEffTech:6, selfEffAll:4,
            resAlliance:12, resRupture:10, resEvoc:4 },
  craving:  { wReadiness:0.45, wResist:0.25, wTrigger:0.30, wSober:0.20, alpha:0.5 },
  anxiety:  { gtrFloor:9, baseFloor:2, decay:0.10, techEffect:3, alpha:0.5 },
  depress:  { techEffect:4, allianceEffect:2, baEffect:2, alpha:0.4 },
  relapse:  { b0:-1.8, bCraving:1.8, bReadiness:1.6, bTrigger:1.8, bHomework:1.0, bSober:1.4, soberCap:90, cravingShock:4, depressShock:4 },
  dropout:  { b0:-4.4, bResist:1.0, bAlliance:4.5, bSession:0.3 }, // ⚠️ провізорно (G.2), контекст UA
  trigger:  { pBase:0.35, sevMin:0.3, sevMax:1.0 },
} as const;
```

## 11. Тести (обов'язково)
- Монотонність: краща суб-оцінка → не гірший напрям відповідної змінної.
- Clamp: жодна шкала не виходить за межі.
- Детермінізм: однаковий `seed` + вхід → ідентичний вихід.
- Safety: непомічена криза завжди ескалує і штрафує.
- Релаксація: спостережувані шкали не стрибають більше за `α·Δtarget + shock`.
