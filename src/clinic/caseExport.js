// caseExport.js — Експорт одного кейса для супервізора (ROADMAP, легкий зріз T5.5 без бекенда).
// Збирає транскрипти всіх сесій + оцінки CTS-R/MITI + траєкторію + результат у структурований
// обʼєкт і рендерить самодостатній друкований HTML (супервізор → «Друк → Зберегти як PDF»).
// Чистий модуль (без DOM/мережі): даних не змінює, лише читає Case + записи Трекера.

import { CTSR_ITEM_LABELS, MITI_GLOBAL_LABELS } from './profile.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STATUS_LABEL = {
  active: 'Активний', discharged: 'Виписка (успіх)', relapsed: 'Зрив',
  dropped_out: 'Відмова від лікування', crisis: 'Криза безпеки'
};

/**
 * Зібрати структурований експорт кейса. Транскрипти беруться із записів Трекера
 * (`patient.records[].dialogue`), числові оцінки — із `kase.sessions[].assessment`.
 * @param {object} kase
 * @param {object} [patient]  пацієнт із Трекера (для транскриптів)
 * @param {object} [opts] { typeLabel?: string, generatedAt?: string }
 * @returns {object} структурований експорт
 */
export function buildCaseExport(kase, patient = null, opts = {}) {
  if (!kase) throw new Error('Немає кейса для експорту.');
  const practice = (patient?.records || []).filter((r) => r.isPractice);

  const sessions = (kase.sessions || []).map((sess, i) => {
    const rec = practice[i];
    const transcript = (rec?.dialogue || [])
      .filter((d) => d.type === 'you' || d.type === 'patient')
      .map((d) => ({ role: d.type === 'you' ? 'Терапевт' : 'Пацієнт', text: d.text }));
    const a = sess.assessment || {};
    return {
      index: sess.index,
      date: sess.date || rec?.date || '',
      transcript,
      ctsr: a.ctsr || {},
      ctsrTotal: a.ctsrTotal ?? null,
      miti: a.miti || {},
      events: a.events || {},
      narrative: a.narrative || rec?.ctsReport || '',
      durationTurns: a.durationTurns ?? transcript.filter((t) => t.role === 'Терапевт').length
    };
  });

  const eventsByType = {};
  for (const e of (kase.events || [])) eventsByType[e.type] = (eventsByType[e.type] || 0) + 1;

  return {
    generatedAt: opts.generatedAt || new Date().toISOString(),
    meta: {
      name: kase.profile?.displayName || 'Пацієнт',
      typeLabel: opts.typeLabel || kase.profile?.disorderType || '',
      stage: kase.profile?.treatmentStage || '',
      status: kase.status,
      statusLabel: STATUS_LABEL[kase.status] || kase.status,
      summary: kase.outcome?.summary || (kase.status === 'active' ? 'Випадок триває.' : ''),
      difficulty: kase.profile?.difficulty ?? null,
      templateTitle: kase.profile?.templateTitle || null,
      sessionsCount: sessions.length
    },
    sessions,
    finalState: kase.state || null,
    keyMoments: kase.outcome?.keyMoments || [],
    eventsByType
  };
}

const fmtState = (s) => s ? [
  `PACS ${Math.round(s.pacs ?? 0)}/30`, `PHQ-9 ${Math.round(s.phq9 ?? 0)}/27`,
  `GAD-7 ${Math.round(s.gad7 ?? 0)}/21`, `Готовність ${Math.round(s.readiness ?? 0)}%`,
  `Альянс ${Math.round(s.alliance ?? 0)}%`, `Тверезість ${Math.round(s.soberDays ?? 0)} дн.`
].join(' · ') : '—';

function ctsrRows(ctsr) {
  return Object.entries(CTSR_ITEM_LABELS)
    .map(([k, label]) => `<tr><td>${esc(label)}</td><td class="num">${ctsr[k] ?? '—'}<span class="muted">/6</span></td></tr>`)
    .join('');
}
function mitiRows(miti) {
  const rows = Object.entries(MITI_GLOBAL_LABELS)
    .map(([k, label]) => `<tr><td>${esc(label)}</td><td class="num">${miti[k] ?? '—'}<span class="muted">/5</span></td></tr>`)
    .join('');
  const r2q = miti.reflectionToQuestion != null ? Math.round(miti.reflectionToQuestion * 100) / 100 : '—';
  const cpx = miti.complexReflectionPct != null ? Math.round(miti.complexReflectionPct * 100) + '%' : '—';
  return rows
    + `<tr><td>Рефлексії : запитання</td><td class="num">${r2q}</td></tr>`
    + `<tr><td>Складні рефлексії</td><td class="num">${cpx}</td></tr>`;
}

function sessionHtml(s) {
  const turns = s.transcript.map((t) =>
    `<p class="turn ${t.role === 'Терапевт' ? 'th' : 'pt'}"><b>${esc(t.role)}:</b> ${esc(t.text)}</p>`).join('');
  const ev = s.events || {};
  const flags = [
    ev.safetyFlagPresent ? `Безпека: ${ev.safetyHandled ? 'опрацьовано ✓' : 'НЕ опрацьовано ✗'}` : null,
    ev.homeworkAssigned ? 'ДЗ призначено' : null,
    ev.ruptures ? `MI-розриви: ${ev.ruptures}` : null
  ].filter(Boolean).join(' · ') || '—';
  return `<section class="ses">
    <h2>Сесія ${s.index}${s.date ? ` · ${esc(s.date)}` : ''}</h2>
    <div class="cols">
      <div class="col">
        <h3>CTS-R (${s.ctsrTotal ?? '—'}/72)</h3>
        <table>${ctsrRows(s.ctsr)}</table>
      </div>
      <div class="col">
        <h3>MITI</h3>
        <table>${mitiRows(s.miti)}</table>
        <p class="flags"><b>Ключові події:</b> ${esc(flags)}</p>
      </div>
    </div>
    ${s.narrative ? `<h3>Звіт супервізора</h3><div class="narr">${esc(s.narrative)}</div>` : ''}
    <h3>Транскрипт (${s.transcript.filter((t) => t.role === 'Терапевт').length} ходів терапевта)</h3>
    <div class="transcript">${turns || '<p class="muted">Транскрипт недоступний.</p>'}</div>
  </section>`;
}

/**
 * Рендер самодостатнього друкованого HTML зі структурованого експорту.
 * @param {object} exp  результат buildCaseExport
 * @returns {string} повний HTML-документ
 */
export function caseExportToHtml(exp) {
  const m = exp.meta;
  const head = [
    m.typeLabel, m.stage,
    m.templateTitle ? `шаблон «${m.templateTitle}»` : null,
    m.difficulty ? `складність ${m.difficulty}/5` : null
  ].filter(Boolean).map(esc).join(' · ');
  const moments = (exp.keyMoments || []).length
    ? `<ul>${exp.keyMoments.map((k) => `<li>Сесія ${k.sessionIndex}: ${esc(k.note)}</li>`).join('')}</ul>`
    : '<p class="muted">Поворотних моментів не зафіксовано.</p>';
  const evByType = Object.entries(exp.eventsByType || {}).map(([t, n]) => `${esc(t)}: ${n}`).join(' · ') || '—';

  return `<!doctype html><html lang="uk"><head><meta charset="utf-8">
<title>Звіт для супервізора — ${esc(m.name)}</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:820px;margin:24px auto;padding:0 16px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:17px;border-bottom:2px solid #2e7d6b;padding-bottom:4px;margin:22px 0 10px}
  h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#555;margin:14px 0 6px}
  .sub{color:#555;margin:0 0 12px} .muted{color:#888}
  .summary{background:#eaf3f0;border-left:4px solid #2e7d6b;padding:10px 12px;border-radius:8px;margin:12px 0}
  .cols{display:flex;gap:20px;flex-wrap:wrap} .col{flex:1;min-width:240px}
  table{width:100%;border-collapse:collapse} td{padding:3px 6px;border-bottom:1px solid #eee} td.num{text-align:right;white-space:nowrap}
  .flags{margin-top:8px;font-size:13px} .narr{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:8px;padding:10px;font-size:13px}
  .transcript{font-size:13px} .turn{margin:4px 0} .turn.th{color:#1a5e4f} .turn.pt{color:#333}
  .ses{page-break-inside:avoid} footer{margin-top:30px;color:#999;font-size:11px;border-top:1px solid #eee;padding-top:10px}
  @media print{body{margin:0}}
</style></head><body>
<h1>Звіт для супервізора: ${esc(m.name)}</h1>
<p class="sub">${head}</p>
<p><b>Статус:</b> ${esc(m.statusLabel)} · <b>Сесій:</b> ${m.sessionsCount}</p>
${m.summary ? `<div class="summary">${esc(m.summary)}</div>` : ''}
<h2>Фінальний стан і події курсу</h2>
<p>${esc(fmtState(exp.finalState))}</p>
<p><b>Поворотні моменти:</b></p>${moments}
<p class="muted">Події рушія за курс: ${evByType}</p>
${exp.sessions.map(sessionHtml).join('')}
<footer>Згенеровано КПТ-Клінікою (VCT) · ${esc(exp.generatedAt)} · Числа — детермінований симуляційний рушій, не LLM. Контент кейсів потребує валідації клініциста.</footer>
</body></html>`;
}
