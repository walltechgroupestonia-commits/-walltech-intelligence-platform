const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const HOST = process.env.WALLTECH_DEAL_PRODUCT_HOST || '127.0.0.1';
const PORT = Number(process.env.WALLTECH_DEAL_PRODUCT_PORT || 8787);
const ROOT = process.cwd();
const CYCLE_DIR = path.join(ROOT, 'runtime/state/communication-cycles');
const CONTROL_DIR = path.join(ROOT, 'runtime/state/deal-control');
const CONTROL_FILE = path.join(CONTROL_DIR, 'control.json');

const EVALUATION = ['PENDING', 'YES', 'NO'];
const WORKFLOW = [
  'EVALUATION',
  'DEAL_MAP',
  'ECONOMIC_MAP',
  'AGREEMENT_GATE',
  'DOCUMENTATION_DD',
  'COUNTERPARTY_QUALIFICATION',
  'OFFER_PROPOSAL',
  'NEGOTIATION',
  'CLOSING',
  'FEE_MATURITY',
  'INVOICE',
  'PAYMENT',
  'STOP',
  'PARK',
  'NO_GO',
];
const AGREEMENT = ['NOT_OPEN', 'PENDING', 'PASSED', 'BLOCKED'];
const FEE_STATUS = ['UNDEFINED', 'POTENTIAL', 'PROTECTED', 'MATURE', 'INVOICED', 'PAID'];
const ROLES = [
  'OWNER',
  'COLLABORATOR',
  'INTRODUCER',
  'ADVISOR',
  'FACILITATOR',
  'SELL_SIDE',
  'BUY_SIDE',
  'BUY_SIDE_RELATION',
  'PROFESSIONAL',
  'OTHER',
];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readCycles() {
  if (!fs.existsSync(CYCLE_DIR)) return [];
  return fs.readdirSync(CYCLE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = path.join(CYCLE_DIR, name);
      const cycle = readJson(file, {});
      return { ...cycle, __file: file };
    })
    .filter((cycle) => cycle.dealId && cycle.dealName);
}

function getHubSpotDealId(cycle) {
  const evidence = Array.isArray(cycle.evidence) ? cycle.evidence : [];
  const hit = evidence.find((item) => item && item.hubspotDealId);
  return hit ? String(hit.hubspotDealId) : null;
}

function defaultControl(cycle) {
  return {
    dealId: cycle.dealId,
    evaluation: 'PENDING',
    evaluationReason: '',
    decisionOutcome: '',
    workflowStage: 'EVALUATION',
    agreementGate: 'NOT_OPEN',
    dealValue: Number.isFinite(Number(cycle.commercialValue)) ? Number(cycle.commercialValue) : null,
    currency: 'EUR',
    walltechFee: Number.isFinite(Number(cycle.feeValue)) ? Number(cycle.feeValue) : null,
    feeStatus: Number.isFinite(Number(cycle.feeValue)) ? 'POTENTIAL' : 'UNDEFINED',
    missingToAdvance: cycle.currentBlocker || 'Deal Evaluation required before production.',
    nextAction: 'Complete Deal Evaluation and decide YES / NO.',
    participants: [],
    updatedAt: nowIso(),
  };
}

function seedKnownReality(cycle, control) {
  const text = `${cycle.dealId} ${cycle.dealName}`.toLowerCase();

  if (text.includes('opp-004') || text.includes('predict') || text.includes('optip')) {
    control.evaluation = 'PENDING';
    control.workflowStage = 'EVALUATION';
    control.agreementGate = 'NOT_OPEN';
    control.feeStatus = 'UNDEFINED';
    control.missingToAdvance =
      'Economic model, paid scope/SOW, fee payer, fee amount, fee maturity and agreement boundary must be defined before additional resource-intensive market work.';
    control.nextAction =
      'Define the paid engagement model for Predict / OPTIP before producing additional deep market research.';
  }

  if (text.includes('vitaly')) {
    if (!Array.isArray(control.participants) || control.participants.length === 0) {
      control.participants = [
        { name: 'Max / Walltech', email: '', role: 'OWNER', reportAccess: false, feeValue: null, feeType: '', feeStatus: 'UNDEFINED' },
        { name: 'Vincenzo Molaro', email: '', role: 'COLLABORATOR', reportAccess: false, feeValue: null, feeType: '', feeStatus: 'UNDEFINED' },
        { name: 'Natalino Minichiello', email: '', role: 'ADVISOR', reportAccess: false, feeValue: null, feeType: '', feeStatus: 'UNDEFINED' },
        { name: 'Stefania Ranzoni', email: '', role: 'BUY_SIDE_RELATION', reportAccess: false, feeValue: null, feeType: '', feeStatus: 'UNDEFINED' },
      ];
    }
    control.evaluation = control.evaluation || 'PENDING';
    control.workflowStage = control.workflowStage || 'EVALUATION';
    control.missingToAdvance = control.missingToAdvance || cycle.currentBlocker || 'Complete Evaluation and define economics / agreements.';
  }

  return control;
}

function loadState() {
  const cycles = readCycles();
  const store = readJson(CONTROL_FILE, { version: 1, updatedAt: null, deals: {} });
  store.deals = store.deals || {};
  let changed = false;

  for (const cycle of cycles) {
    if (!store.deals[cycle.dealId]) {
      store.deals[cycle.dealId] = seedKnownReality(cycle, defaultControl(cycle));
      changed = true;
    } else {
      const current = store.deals[cycle.dealId];
      if (!Array.isArray(current.participants)) current.participants = [];
    }
  }

  if (changed || !store.updatedAt) {
    store.updatedAt = nowIso();
    writeJsonAtomic(CONTROL_FILE, store);
  }

  const merged = cycles.map((cycle) => {
    const control = store.deals[cycle.dealId] || defaultControl(cycle);
    const productionAuthorized = control.evaluation === 'YES' && control.agreementGate === 'PASSED';
    return {
      cycle,
      control,
      productionAuthorized,
      hubspotDealId: getHubSpotDealId(cycle),
    };
  });

  return { store, deals: merged };
}

function saveStore(store) {
  store.updatedAt = nowIso();
  writeJsonAtomic(CONTROL_FILE, store);
}

function statusClass(value) {
  if (['YES', 'PASSED', 'PAID', 'MATURE', 'PROTECTED'].includes(value)) return 'good';
  if (['NO', 'BLOCKED', 'NO_GO'].includes(value)) return 'bad';
  if (['PENDING', 'NOT_OPEN', 'POTENTIAL', 'UNDEFINED', 'PARK'].includes(value)) return 'warn';
  return 'neutral';
}

function badge(value) {
  return `<span class="badge ${statusClass(value)}">${esc(value)}</span>`;
}

function money(value, currency = 'EUR') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(Number(value));
}

function select(name, values, current) {
  return `<select name="${esc(name)}">${values.map((value) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select>`;
}

function layout(title, body) {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--navy:#163b59;--ink:#14202b;--muted:#667789;--line:#d8e1e8;--bg:#f4f7f9;--good:#e3f4df;--goodText:#28622d;--warn:#fff1d7;--warnText:#9b5b00;--bad:#fde2e2;--badText:#9c2e2e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink)}main{max-width:1600px;margin:0 auto;padding:28px}header{margin-bottom:22px}.kicker{font-size:12px;letter-spacing:2px;font-weight:700;color:#18709a}h1{font-size:34px;margin:8px 0 5px;color:var(--navy)}h2{color:var(--navy);margin:0 0 14px}.meta{color:var(--muted);font-size:13px}.nav{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.nav a,.button,button{display:inline-block;border:1px solid #c8d5de;background:#fff;color:#14557a;padding:9px 13px;text-decoration:none;font-weight:700;cursor:pointer}.workflow{display:flex;gap:8px;align-items:center;overflow:auto;background:#fff;border:1px solid var(--line);padding:14px;margin:18px 0}.workflow .step{white-space:nowrap;border:1px solid var(--line);padding:10px 12px;font-weight:700;color:var(--navy)}.workflow .arrow{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:10px;margin:16px 0}.card{background:#fff;border:1px solid var(--line);padding:15px}.card .label{font-size:11px;color:var(--muted);letter-spacing:1px;text-transform:uppercase}.card .value{font-size:25px;font-weight:800;color:var(--navy);margin-top:7px}section{background:#fff;border:1px solid var(--line);padding:18px;margin:16px 0}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:1250px}th{background:#173f5d;color:#fff;text-align:left;padding:10px;font-size:12px}td{border-bottom:1px solid var(--line);padding:10px;vertical-align:top;font-size:12px;line-height:1.4}.badge{display:inline-block;padding:4px 8px;border-radius:12px;font-weight:800;font-size:10px}.good{background:var(--good);color:var(--goodText)}.warn{background:var(--warn);color:var(--warnText)}.bad{background:var(--bad);color:var(--badText)}.neutral{background:#e9eef2;color:#425466}.detail-grid{display:grid;grid-template-columns:2fr 1fr;gap:16px}.form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.field label{display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:5px}.field input,.field select,.field textarea{width:100%;padding:9px;border:1px solid #cbd7df;background:#fff}.field textarea{min-height:85px}.span3{grid-column:span 3}.people{display:grid;grid-template-columns:repeat(4,minmax(170px,1fr));gap:10px}.person{border:1px solid var(--line);padding:12px;background:#fafcfd}.person strong{color:var(--navy)}.tiny{font-size:11px;color:var(--muted)}.danger-note{background:#fff4f4;border:1px solid #efc2c2;color:#882929;padding:12px;font-weight:700}.good-note{background:#f1faef;border:1px solid #c9e4c4;color:#2d6a31;padding:12px;font-weight:700}@media(max-width:1000px){main{padding:14px}.cards{grid-template-columns:repeat(2,1fr)}.detail-grid,.form-grid{grid-template-columns:1fr}.span3{grid-column:auto}.people{grid-template-columns:1fr 1fr}}
</style>
</head><body><main>${body}</main></body></html>`;
}

function workflowRibbon() {
  const steps = ['ARRIVO DEAL', 'EVALUATION YES/NO', 'DEAL MAP', 'ECONOMIC MAP', 'AGREEMENT GATE', 'PRODUCTION', 'DD', 'OFFER', 'NEGOTIATION', 'CLOSING', 'FEE MATURITY', 'INVOICE', 'PAYMENT', 'STOP'];
  return `<div class="workflow">${steps.map((step, index) => `${index ? '<span class="arrow">→</span>' : ''}<span class="step">${esc(step)}</span>`).join('')}</div>`;
}

function masterPage() {
  const { deals } = loadState();
  const counts = {
    total: deals.length,
    evaluationPending: deals.filter((d) => d.control.evaluation === 'PENDING').length,
    evaluationYes: deals.filter((d) => d.control.evaluation === 'YES').length,
    evaluationNo: deals.filter((d) => d.control.evaluation === 'NO').length,
    agreementPassed: deals.filter((d) => d.control.agreementGate === 'PASSED').length,
    authorized: deals.filter((d) => d.productionAuthorized).length,
  };

  const rows = deals.map(({ cycle, control, productionAuthorized }) => `
<tr>
<td><a href="/deal?id=${encodeURIComponent(cycle.dealId)}"><strong>${esc(cycle.dealName)}</strong></a><div class="tiny">${esc(cycle.dealId)}</div></td>
<td>${badge(control.evaluation)}</td>
<td>${esc(control.workflowStage)}</td>
<td>${badge(control.agreementGate)}</td>
<td>${productionAuthorized ? badge('YES') : badge('NO')}</td>
<td>${esc(control.missingToAdvance || '—')}</td>
<td><strong>${esc(control.nextAction || '—')}</strong></td>
<td>${money(control.dealValue, control.currency)}</td>
<td>${money(control.walltechFee, control.currency)}<div class="tiny">${esc(control.feeStatus)}</div></td>
</tr>`).join('');

  return layout('Walltech — Deal Workflow Control', `
<header><div class="kicker">WALLTECH OPERATING SYSTEM</div><h1>Deal Workflow Control</h1><div class="meta">Filiera standard universale · Evaluation prima della produzione · Agreement Gate prima della produzione significativa</div><div class="nav"><a href="/">Deal Control</a><a href="/reports">Report Collaboratori</a></div></header>
${workflowRibbon()}
<div class="cards">
<div class="card"><div class="label">Deal</div><div class="value">${counts.total}</div></div>
<div class="card"><div class="label">Evaluation Pending</div><div class="value">${counts.evaluationPending}</div></div>
<div class="card"><div class="label">Evaluation YES</div><div class="value">${counts.evaluationYes}</div></div>
<div class="card"><div class="label">Evaluation NO</div><div class="value">${counts.evaluationNo}</div></div>
<div class="card"><div class="label">Agreement Passed</div><div class="value">${counts.agreementPassed}</div></div>
<div class="card"><div class="label">Production Authorized</div><div class="value">${counts.authorized}</div></div>
</div>
<section><h2>Pipeline dei Deal</h2><div class="table-wrap"><table><thead><tr><th>Deal</th><th>Evaluation</th><th>Workflow Stage</th><th>Agreement Gate</th><th>Production</th><th>Missing to Advance</th><th>Next Action</th><th>Deal Value</th><th>Walltech Fee</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section><div class="tiny">Regola: HubSpot / Mail / Max originano il deal. Nessuna production authorization viene calcolata TRUE se Evaluation ≠ YES o Agreement Gate ≠ PASSED. Report send automatico: DISABLED.</div></section>`);
}

function dealPage(dealId) {
  const { deals } = loadState();
  const item = deals.find((d) => d.cycle.dealId === dealId);
  if (!item) return layout('Deal non trovato', '<h1>Deal non trovato</h1><a href="/">← Torna</a>');
  const { cycle, control, productionAuthorized, hubspotDealId } = item;
  const people = (control.participants || []).map((p) => `<div class="person"><div class="tiny">${esc(p.role)}</div><strong>${esc(p.name || p.email || 'Unnamed')}</strong><div>${esc(p.email || 'email non definita')}</div><div class="tiny">Report: ${p.reportAccess ? 'YES' : 'NO'} · Fee: ${money(p.feeValue, control.currency)} · ${esc(p.feeStatus || 'UNDEFINED')}</div></div>`).join('') || '<div class="meta">Nessun partecipante definito.</div>';
  const prodNote = productionAuthorized
    ? '<div class="good-note">PRODUCTION AUTHORIZED — Evaluation YES + Agreement Gate PASSED.</div>'
    : '<div class="danger-note">PRODUCTION NOT AUTHORIZED — Evaluation YES e Agreement Gate PASSED sono entrambi obbligatori.</div>';

  return layout(`Walltech — ${cycle.dealName}`, `
<header><div class="kicker">WALLTECH DEAL CONTROL</div><h1>${esc(cycle.dealName)}</h1><div class="meta">${esc(cycle.dealId)} · Source state updated: ${esc(cycle.updatedAt || cycle.lastEvidenceAt || 'unknown')}</div><div class="nav"><a href="/">← Deal Workflow</a><a href="/reports">Report Collaboratori</a>${hubspotDealId ? `<span class="button">HubSpot ID ${esc(hubspotDealId)}</span>` : ''}</div></header>
${prodNote}
<div class="detail-grid">
<section><h2>Deal Control</h2>
<form method="post" action="/control/deal">
<input type="hidden" name="dealId" value="${esc(cycle.dealId)}">
<div class="form-grid">
<div class="field"><label>EVALUATION</label>${select('evaluation', EVALUATION, control.evaluation)}</div>
<div class="field"><label>WORKFLOW STAGE</label>${select('workflowStage', WORKFLOW, control.workflowStage)}</div>
<div class="field"><label>AGREEMENT GATE</label>${select('agreementGate', AGREEMENT, control.agreementGate)}</div>
<div class="field"><label>DEAL VALUE</label><input name="dealValue" value="${esc(control.dealValue ?? '')}" inputmode="decimal"></div>
<div class="field"><label>WALLTECH FEE</label><input name="walltechFee" value="${esc(control.walltechFee ?? '')}" inputmode="decimal"></div>
<div class="field"><label>FEE STATUS</label>${select('feeStatus', FEE_STATUS, control.feeStatus)}</div>
<div class="field span3"><label>EVALUATION REASON / WHY</label><textarea name="evaluationReason">${esc(control.evaluationReason || '')}</textarea></div>
<div class="field span3"><label>MISSING TO ADVANCE</label><textarea name="missingToAdvance">${esc(control.missingToAdvance || '')}</textarea></div>
<div class="field span3"><label>NEXT ACTION</label><textarea name="nextAction">${esc(control.nextAction || '')}</textarea></div>
<div class="field"><button type="submit">SALVA CONTROLLO DEAL</button></div>
</div></form></section>
<section><h2>Evidence corrente</h2><p><strong>Latest:</strong> ${esc(cycle.latestDone || cycle.latestUpdate || cycle.status || '—')}</p><p><strong>Blocker:</strong> ${esc(cycle.currentBlocker || '—')}</p><p><strong>Priority:</strong> ${esc(cycle.priority || '—')}</p><p><strong>Last evidence:</strong> ${esc(cycle.lastEvidenceAt || '—')}</p></section>
</div>
<section><h2>Deal Organigram</h2><div class="people">${people}</div></section>
<section><h2>Aggiungi / aggiorna partecipante</h2><form method="post" action="/control/participant"><input type="hidden" name="dealId" value="${esc(cycle.dealId)}"><div class="form-grid">
<div class="field"><label>NOME</label><input name="name"></div>
<div class="field"><label>EMAIL — chiave report</label><input name="email" type="email" required></div>
<div class="field"><label>RUOLO</label>${select('role', ROLES, 'COLLABORATOR')}</div>
<div class="field"><label>REPORT ACCESS</label><select name="reportAccess"><option value="NO">NO</option><option value="YES">YES</option></select></div>
<div class="field"><label>FEE PERSONA</label><input name="feeValue" inputmode="decimal"></div>
<div class="field"><label>FEE TYPE</label><input name="feeType" placeholder="% / FIXED / OTHER"></div>
<div class="field"><label>FEE STATUS</label>${select('participantFeeStatus', FEE_STATUS, 'UNDEFINED')}</div>
<div class="field"><button type="submit">SALVA PARTECIPANTE</button></div>
</div></form></section>`);
}

function reportsIndex() {
  const { deals } = loadState();
  const byEmail = new Map();
  for (const { cycle, control } of deals) {
    for (const p of control.participants || []) {
      const email = String(p.email || '').trim().toLowerCase();
      if (!email || !p.reportAccess) continue;
      if (!byEmail.has(email)) byEmail.set(email, { email, name: p.name || email, deals: [] });
      byEmail.get(email).deals.push(cycle.dealId);
    }
  }
  const rows = [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name)).map((item) => `<tr><td><strong>${esc(item.name)}</strong><div class="tiny">${esc(item.email)}</div></td><td>${item.deals.length}</td><td><a class="button" href="/report?email=${encodeURIComponent(item.email)}">APRI REPORT</a></td></tr>`).join('');
  return layout('Walltech — Report Collaboratori', `<header><div class="kicker">WALLTECH OPERATING SYSTEM</div><h1>Report Collaboratori</h1><div class="meta">Deal-centric · Max decide report access tramite email sul singolo deal</div><div class="nav"><a href="/">← Deal Workflow</a></div></header><section><h2>Destinatari autorizzati</h2><div class="table-wrap"><table><thead><tr><th>Persona</th><th>Deal nel report</th><th>Report</th></tr></thead><tbody>${rows || '<tr><td colspan="3">Nessun destinatario con Report Access = YES.</td></tr>'}</tbody></table></div></section><section><div class="tiny">SEND ENABLED = NO · La presenza nel report è controllata per deal e per email.</div></section>`);
}

function recipientReport(emailInput) {
  const email = String(emailInput || '').trim().toLowerCase();
  const { deals } = loadState();
  const matched = [];
  let displayName = email;
  for (const item of deals) {
    const participant = (item.control.participants || []).find((p) => String(p.email || '').trim().toLowerCase() === email && p.reportAccess);
    if (!participant) continue;
    displayName = participant.name || displayName;
    matched.push({ ...item, participant });
  }
  const totalFee = matched.reduce((sum, item) => sum + (Number.isFinite(Number(item.participant.feeValue)) ? Number(item.participant.feeValue) : 0), 0);
  const rows = matched.map(({ cycle, control, participant }) => `<tr><td><a href="/deal?id=${encodeURIComponent(cycle.dealId)}"><strong>${esc(cycle.dealName)}</strong></a></td><td>${badge(control.evaluation)}</td><td>${esc(control.workflowStage)}</td><td>${badge(control.agreementGate)}</td><td>${esc(control.missingToAdvance || '—')}</td><td><strong>${esc(control.nextAction || '—')}</strong></td><td>${money(control.dealValue, control.currency)}</td><td>${money(participant.feeValue, control.currency)}<div class="tiny">${esc(participant.feeStatus || 'UNDEFINED')}</div></td></tr>`).join('');
  return layout(`Walltech — Report ${displayName}`, `<header><div class="kicker">WALLTECH · REPORT COLLABORATORE</div><h1>${esc(displayName || email)}</h1><div class="meta">${esc(email)} · Generated ${esc(nowIso())}</div><div class="nav"><a href="/reports">← Report Collaboratori</a></div></header><div class="cards"><div class="card"><div class="label">Deal</div><div class="value">${matched.length}</div></div><div class="card"><div class="label">Fee assegnate</div><div class="value">${money(totalFee, 'EUR')}</div></div><div class="card"><div class="label">Action Required</div><div class="value">${matched.filter((d) => d.control.nextAction).length}</div></div></div><section><h2>Deal condivisi</h2><div class="table-wrap"><table><thead><tr><th>Deal</th><th>Evaluation</th><th>Workflow</th><th>Agreement Gate</th><th>Missing to Advance</th><th>Next Action</th><th>Deal Value</th><th>Fee assegnata</th></tr></thead><tbody>${rows || '<tr><td colspan="8">Nessun deal autorizzato.</td></tr>'}</tbody></table></div></section><section><div class="tiny">SEND ENABLED = NO · Report data controlled by Max on each deal.</div></section>`);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

function numberOrNull(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

async function handlePost(req, res, pathname) {
  const form = await parseBody(req);
  const dealId = form.get('dealId');
  const { store, deals } = loadState();
  const item = deals.find((d) => d.cycle.dealId === dealId);
  if (!item || !store.deals[dealId]) {
    res.writeHead(404); res.end('Deal not found'); return;
  }

  if (pathname === '/control/deal') {
    const c = store.deals[dealId];
    const evaluation = form.get('evaluation');
    const workflowStage = form.get('workflowStage');
    const agreementGate = form.get('agreementGate');
    const feeStatus = form.get('feeStatus');
    if (EVALUATION.includes(evaluation)) c.evaluation = evaluation;
    if (WORKFLOW.includes(workflowStage)) c.workflowStage = workflowStage;
    if (AGREEMENT.includes(agreementGate)) c.agreementGate = agreementGate;
    if (FEE_STATUS.includes(feeStatus)) c.feeStatus = feeStatus;
    c.dealValue = numberOrNull(form.get('dealValue'));
    c.walltechFee = numberOrNull(form.get('walltechFee'));
    c.evaluationReason = form.get('evaluationReason') || '';
    c.missingToAdvance = form.get('missingToAdvance') || '';
    c.nextAction = form.get('nextAction') || '';
    if (c.evaluation !== 'YES') {
      c.agreementGate = 'NOT_OPEN';
      if (c.evaluation === 'NO' && !['PARK', 'NO_GO'].includes(c.workflowStage)) c.workflowStage = 'PARK';
      if (c.evaluation === 'PENDING') c.workflowStage = 'EVALUATION';
    }
    if (c.evaluation === 'YES' && c.workflowStage === 'EVALUATION') c.workflowStage = 'DEAL_MAP';
    c.updatedAt = nowIso();
    saveStore(store);
    redirect(res, `/deal?id=${encodeURIComponent(dealId)}`);
    return;
  }

  if (pathname === '/control/participant') {
    const c = store.deals[dealId];
    const email = String(form.get('email') || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      res.writeHead(400); res.end('Valid email required'); return;
    }
    const role = form.get('role');
    const reportAccess = form.get('reportAccess') === 'YES';
    const feeStatus = form.get('participantFeeStatus');
    const existing = (c.participants || []).find((p) => String(p.email || '').trim().toLowerCase() === email);
    const data = {
      name: form.get('name') || email,
      email,
      role: ROLES.includes(role) ? role : 'OTHER',
      reportAccess,
      feeValue: numberOrNull(form.get('feeValue')),
      feeType: form.get('feeType') || '',
      feeStatus: FEE_STATUS.includes(feeStatus) ? feeStatus : 'UNDEFINED',
    };
    if (existing) Object.assign(existing, data); else c.participants.push(data);
    c.updatedAt = nowIso();
    saveStore(store);
    redirect(res, `/deal?id=${encodeURIComponent(dealId)}`);
    return;
  }

  res.writeHead(404); res.end('Not found');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (req.method === 'POST') return await handlePost(req, res, url.pathname);

    let html;
    if (url.pathname === '/') html = masterPage();
    else if (url.pathname === '/deal') html = dealPage(url.searchParams.get('id'));
    else if (url.pathname === '/reports') html = reportsIndex();
    else if (url.pathname === '/report') html = recipientReport(url.searchParams.get('email'));
    else { res.writeHead(404); res.end('Not found'); return; }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Internal error: ${error.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`WALLTECH DEAL PRODUCT: LIVE http://${HOST}:${PORT}/`);
  console.log(`CONTROL FILE: ${CONTROL_FILE}`);
  console.log('AUTO EMAIL SEND: NONE');
  console.log('HUBSPOT WRITE: NONE');
});
