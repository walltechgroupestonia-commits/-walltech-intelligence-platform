const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const {
  ingestCalendlyWebhook,
} = require('../leads/ingest-calendly-webhook');

const HOST = process.env.WALLTECH_DEAL_PRODUCT_HOST || '127.0.0.1';
const PORT = Number(process.env.WALLTECH_DEAL_PRODUCT_PORT || 8787);
const ROOT = process.cwd();
const CYCLE_DIR = path.join(ROOT, 'runtime/state/communication-cycles');

const MANAGEMENT_OUTPUT_DIR =
  path.join(ROOT, 'runtime/state/management-output');
const CONTROL_DIR = path.join(ROOT, 'runtime/state/deal-control');
const CONTROL_FILE = path.join(CONTROL_DIR, 'control.json');

const RECONCILIATION_DIR =
  path.join(ROOT, 'runtime/state/generic-reconciliation');

const RECONCILIATION_REVIEW_FILE =
  path.join(RECONCILIATION_DIR, 'review-decisions.json');


const WALLTECH_MAILBOXES = new Set([
  'info@walltechgroup.eu',
  'marketingdept@walltechgroup.eu',
  'walltechgroup.estonia@gmail.com',
]);


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

const CHECK_STATUS = ['MISSING', 'CONFIRMED'];

const EVALUATION_CRITERIA = [
  ['evaluationProduct', 'PRODUCT'],
  ['evaluationReality', 'REALITY / EVIDENCE'],
  ['evaluationCounterparties', 'COUNTERPARTIES'],
  ['evaluationWalltechRole', 'WALLTECH ROLE'],
  ['evaluationMonetization', 'MONETIZATION MODEL'],
  ['evaluationFeePayer', 'POTENTIAL FEE PAYER'],
  ['evaluationTimeToRevenue', 'TIME TO REVENUE'],
  ['evaluationResourceCost', 'RESOURCE COST'],
  ['evaluationCompliance', 'COMPLIANCE'],
];
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

const REPORT_LANGUAGES = [
  ['it', 'Italiano'],
  ['en', 'English'],
  ['et', 'Eesti'],
  ['ru', 'Русский'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['pl', 'Polski'],
  ['lv', 'Latviešu'],
  ['lt', 'Lietuvių'],
  ['fi', 'Suomi'],
  ['sv', 'Svenska'],
];

function reportLanguageSelect(
  name,
  current = 'it'
) {
  return `<select name="${esc(name)}">${
    REPORT_LANGUAGES
      .map(([code, label]) =>
        `<option value="${esc(code)}"${
          code === current
            ? ' selected'
            : ''
        }>${esc(label)}</option>`
      )
      .join('')
  }</select>`;
}

function reportLanguageLabel(code) {
  const match =
    REPORT_LANGUAGES.find(
      ([candidate]) =>
        candidate === code
    );

  return match
    ? match[1]
    : 'Italiano';
}


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


function readManagementOutput(dealId) {
  const file =
    path.join(
      MANAGEMENT_OUTPUT_DIR,
      `${dealId}.json`
    );

  return readJson(
    file,
    null
  );
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

function addressValue(entry) {
  if (!entry) return '';

  if (typeof entry === 'string') {
    return entry.trim().toLowerCase();
  }

  if (
    typeof entry === 'object' &&
    entry.address
  ) {
    return String(
      entry.address
    ).trim().toLowerCase();
  }

  return '';
}


function addressesFrom(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map(addressValue)
    .filter(Boolean);
}


function detectMailDirection(evidence) {
  const from =
    addressesFrom(
      evidence.participants?.from
    );

  const to = [
    ...addressesFrom(
      evidence.participants?.to
    ),
    ...addressesFrom(
      evidence.participants?.cc
    ),
  ];

  const fromWalltech =
    from.some(
      (address) =>
        WALLTECH_MAILBOXES.has(address)
    );

  const toWalltech =
    to.some(
      (address) =>
        WALLTECH_MAILBOXES.has(address)
    );

  if (fromWalltech) {
    return 'OUT';
  }

  if (toWalltech) {
    return 'IN';
  }

  return 'UNKNOWN';
}


function participantLabel(list) {
  if (!Array.isArray(list)) {
    return '—';
  }

  const labels =
    list
      .map((entry) => {
        if (!entry) return null;

        if (typeof entry === 'string') {
          return entry;
        }

        return (
          entry.name ||
          entry.address ||
          null
        );
      })
      .filter(Boolean);

  return labels.length
    ? labels.join(', ')
    : '—';
}


function mailEvidenceFromCycle(cycle) {
  const evidence =
    Array.isArray(cycle.evidence)
      ? cycle.evidence
      : [];

  return evidence
    .filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        item.evidenceType ===
          'MAIL_EVIDENCE'
    )
    .map((item) => {
      const observedAt =
        item.identity?.date ||
        item.identity?.internalDate ||
        item.acquisitionEvidence
          ?.acquiredAt ||
        item.createdAt ||
        null;

      return {
        evidenceId:
          item.evidenceId || null,

        direction:
          detectMailDirection(item),

        observedAt,

        subject:
          item.identity?.subject ||
          '(senza oggetto)',

        from:
          participantLabel(
            item.participants?.from
          ),

        to:
          participantLabel(
            item.participants?.to
          ),

        attachmentCount:
          Number(
            item.attachmentCount || 0
          ),

        messageId:
          item.identity?.messageId ||
          null,
      };
    })
    .sort((a, b) => {
      const at =
        Date.parse(a.observedAt || '') ||
        0;

      const bt =
        Date.parse(b.observedAt || '') ||
        0;

      return bt - at;
    });
}


function formatCommunicationDate(value) {
  if (!value) {
    return 'Data non disponibile';
  }

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    'it-IT',
    {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Tallinn',
    }
  ).format(date);
}




function canonicalCommunicationTimelineHtml(cycle) {
  const source =
    Array.isArray(cycle.evidence)
      ? cycle.evidence
      : [];

  const byKey =
    new Map();

  for (const item of source) {
    if (!item) {
      continue;
    }

    const isMailEvidence =
      item.evidenceType === 'MAIL_EVIDENCE' ||
      Boolean(item.mailEvidenceId) ||
      Boolean(
        item.messageId &&
        item.subject &&
        item.occurredAt
      );

    if (!isMailEvidence) {
      continue;
    }

    const subject =
      String(
        item.subject || ''
      ).trim();

    const occurredAt =
      item.occurredAt ||
      item.date ||
      null;

    /*
     * No placeholder rows:
     * if we cannot identify either a real subject
     * or a real event timestamp, it is not useful
     * communication evidence for the Deal timeline.
     */
    if (
      !subject &&
      !occurredAt
    ) {
      continue;
    }

    const evidenceRef =
      item.evidenceRef ||
      item.mailEvidenceId ||
      item.evidenceId ||
      null;

    const key =
      evidenceRef ||
      item.messageId ||
      `${occurredAt || ''}|${subject}`;

    if (
      byKey.has(key)
    ) {
      continue;
    }

    byKey.set(
      key,
      {
        occurredAt,
        direction:
          item.direction ||
          'UNKNOWN',
        subject:
          subject ||
          '(oggetto non disponibile)',
        evidenceRef,
        confirmed:
          item.bindingSource ===
          'USER_CONFIRMED_BINDING',
      }
    );
  }

  const evidence =
    [...byKey.values()]
      .sort(
        (a, b) =>
          String(a.occurredAt || '')
            .localeCompare(
              String(b.occurredAt || '')
            )
      );

  if (evidence.length === 0) {
    return `
<section>
  <h2>Communication Timeline</h2>
  <div class="meta">
    Nessuna comunicazione email autorevole collegata al Deal.
  </div>
</section>
`;
  }

  const rows =
    evidence
      .map(
        item => `
<tr>
  <td>${esc(item.occurredAt || '—')}</td>
  <td><strong>${esc(item.direction)}</strong></td>
  <td><strong>${esc(item.subject)}</strong></td>
  <td>
    ${
      item.confirmed
        ? '<span class="badge good">MAX CONFIRMED</span>'
        : '<span class="badge neutral">VERIFIED MAIL</span>'
    }
    ${
      item.evidenceRef
        ? `<div class="tiny">${esc(item.evidenceRef)}</div>`
        : ''
    }
  </td>
</tr>`
      )
      .join('');

  return `
<section>
  <h2>Communication Timeline</h2>

  <div class="good-note">
    Cronologia composta esclusivamente da communication evidence reale collegata al Deal.
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Date / Time</th>
          <th>Direction</th>
          <th>Communication</th>
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</section>
`;
}

function confirmedCommunicationTimelineHtml(cycle) {
  const evidence =
    (
      Array.isArray(cycle.evidence)
        ? cycle.evidence
        : []
    )
      .filter(
        item =>
          item &&
          item.evidenceType === 'MAIL_EVIDENCE' &&
          item.bindingSource === 'USER_CONFIRMED_BINDING'
      )
      .sort(
        (a, b) =>
          String(a.occurredAt || '')
            .localeCompare(
              String(b.occurredAt || '')
            )
      );

  if (evidence.length === 0) {
    return '';
  }

  const rows =
    evidence
      .map(
        item => `
<tr>
  <td>
    ${esc(item.occurredAt || '—')}
  </td>

  <td>
    <strong>
      ${esc(item.direction || 'UNKNOWN')}
    </strong>
  </td>

  <td>
    <strong>
      ${esc(item.subject || '—')}
    </strong>
  </td>

  <td>
    <span class="badge good">
      MAX CONFIRMED
    </span>
    <div class="tiny">
      ${esc(item.evidenceRef || item.mailEvidenceId || '—')}
    </div>
  </td>
</tr>`
      )
      .join('');

  return `
<section>
  <h2>Communication Timeline — Confirmed Evidence</h2>

  <div class="good-note">
    Evidence collegata al Deal tramite decisione esplicita Max.
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Date / Time</th>
          <th>Direction</th>
          <th>Communication</th>
          <th>Evidence</th>
        </tr>
      </thead>

      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</section>
`;
}

function communicationTimelineHtml(cycle) {
  const events =
    mailEvidenceFromCycle(cycle);

  if (!events.length) {
    return `
      <div class="timeline-empty">
        Nessuna comunicazione email
        persistita per questo Deal.
      </div>
      <div class="tiny">
        La timeline verrà popolata
        automaticamente dalla
        Mail Evidence associata.
      </div>
    `;
  }

  const visible =
    events.slice(0, 5);

  return `
    <div class="communication-timeline">
      ${visible.map((event) => `
        <div class="timeline-item">
          <div class="timeline-head">
            <span class="direction ${
              event.direction === 'IN'
                ? 'in'
                : event.direction === 'OUT'
                  ? 'out'
                  : ''
            }">
              ${esc(event.direction)}
            </span>

            <strong>
              ${esc(
                formatCommunicationDate(
                  event.observedAt
                )
              )}
            </strong>
          </div>

          <div class="timeline-subject">
            ${esc(event.subject)}
          </div>

          <div class="tiny">
            Da: ${esc(event.from)}
          </div>

          <div class="tiny">
            A: ${esc(event.to)}
          </div>

          <div class="tiny">
            Allegati:
            ${event.attachmentCount}
          </div>
        </div>
      `).join('')}
    </div>

    ${
      events.length > 5
        ? `<div class="tiny">
             ${events.length - 5}
             comunicazioni precedenti
             non mostrate.
           </div>`
        : ''
    }
  `;
}


const NON_DEAL_CYCLE_IDS = new Set([
  'WT-2026-003', // CFI Marketing Campaign
  'WT-2026-008', // Estonia Corporate Gateway
  'WT-2026-009', // Wallthera
  'WT-2026-010', // Fiscal Assets Buyer Campaign
]);

function isDealPipelineEligible(cycle) {
  return !NON_DEAL_CYCLE_IDS.has(
    String(cycle.dealId || '')
  );
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
    evaluationProduct: 'MISSING',
    evaluationReality: 'MISSING',
    evaluationCounterparties: 'MISSING',
    evaluationWalltechRole: 'MISSING',
    evaluationMonetization: 'MISSING',
    evaluationFeePayer: 'MISSING',
    evaluationTimeToRevenue: 'MISSING',
    evaluationResourceCost: 'MISSING',
    evaluationCompliance: 'MISSING',
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

  store.recipientPreferences =
    store.recipientPreferences || {};

  let changed = false;

  for (const cycle of cycles) {
    if (!store.deals[cycle.dealId]) {
      store.deals[cycle.dealId] = seedKnownReality(cycle, defaultControl(cycle));
      changed = true;
    } else {
      const current = store.deals[cycle.dealId];

      if (!Array.isArray(current.participants)) {
        current.participants = [];
        changed = true;
      }

      for (
        const participant
        of current.participants
      ) {
        if (!participant.reportLanguage) {
          participant.reportLanguage = 'it';
          changed = true;
        }
      }


      for (const [key] of EVALUATION_CRITERIA) {
        if (!CHECK_STATUS.includes(current[key])) {
          current[key] = 'MISSING';
          changed = true;
        }
      }
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


function evaluationMissing(control) {
  return EVALUATION_CRITERIA
    .filter(([key]) => control[key] !== 'CONFIRMED')
    .map(([, label]) => label);
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
*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink)}main{max-width:1600px;margin:0 auto;padding:28px}header{margin-bottom:22px}.kicker{font-size:12px;letter-spacing:2px;font-weight:700;color:#18709a}h1{font-size:34px;margin:8px 0 5px;color:var(--navy)}h2{color:var(--navy);margin:0 0 14px}.meta{color:var(--muted);font-size:13px}.nav{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.nav a,.button,button{display:inline-block;border:1px solid #c8d5de;background:#fff;color:#14557a;padding:9px 13px;text-decoration:none;font-weight:700;cursor:pointer}.workflow{display:flex;gap:8px;align-items:center;overflow:auto;background:#fff;border:1px solid var(--line);padding:14px;margin:18px 0}.workflow .step{white-space:nowrap;border:1px solid var(--line);padding:10px 12px;font-weight:700;color:var(--navy)}.workflow .arrow{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:10px;margin:16px 0}.card{background:#fff;border:1px solid var(--line);padding:15px}.card .label{font-size:11px;color:var(--muted);letter-spacing:1px;text-transform:uppercase}.card .value{font-size:25px;font-weight:800;color:var(--navy);margin-top:7px}section{background:#fff;border:1px solid var(--line);padding:18px;margin:16px 0}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:1250px}th{background:#173f5d;color:#fff;text-align:left;padding:10px;font-size:12px}td{border-bottom:1px solid var(--line);padding:10px;vertical-align:top;font-size:12px;line-height:1.4}.badge{display:inline-block;padding:4px 8px;border-radius:12px;font-weight:800;font-size:10px}.good{background:var(--good);color:var(--goodText)}.warn{background:var(--warn);color:var(--warnText)}.bad{background:var(--bad);color:var(--badText)}.neutral{background:#e9eef2;color:#425466}.detail-grid{display:grid;grid-template-columns:2fr 1fr;gap:16px}.form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.field label{display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:5px}.field input,.field select,.field textarea{width:100%;padding:9px;border:1px solid #cbd7df;background:#fff}.field textarea{min-height:85px}.span3{grid-column:span 3}.people{display:grid;grid-template-columns:repeat(4,minmax(170px,1fr));gap:10px}.person{border:1px solid var(--line);padding:12px;background:#fafcfd}.person strong{color:var(--navy)}.tiny{font-size:11px;color:var(--muted)}.danger-note{background:#fff4f4;border:1px solid #efc2c2;color:#882929;padding:12px;font-weight:700}.good-note{background:#f1faef;border:1px solid #c9e4c4;color:#2d6a31;padding:12px;font-weight:700}.communication-timeline{margin-top:12px}.timeline-item{border-left:3px solid #ccd8df;padding:8px 0 8px 11px;margin-bottom:12px}.timeline-head{display:flex;align-items:center;gap:8px;font-size:11px}.direction{display:inline-block;padding:3px 7px;border-radius:10px;background:#e9eef2;font-weight:800}.direction.in{background:#e5f3ff;color:#175e89}.direction.out{background:#e5f5e2;color:#2f6e34}.timeline-subject{font-weight:800;color:var(--navy);margin:5px 0}.timeline-empty{padding:12px;background:#f7f9fa;border:1px dashed #cad5dc;color:var(--muted);margin-top:8px}@media(max-width:1000px){main{padding:14px}.cards{grid-template-columns:repeat(2,1fr)}.detail-grid,.form-grid{grid-template-columns:1fr}.span3{grid-column:auto}.people{grid-template-columns:1fr 1fr}}
</style>
</head><body><main>${body}</main></body></html>`;
}

function workflowRibbon() {
  const steps = ['ARRIVO DEAL', 'EVALUATION YES/NO', 'DEAL MAP', 'ECONOMIC MAP', 'AGREEMENT GATE', 'PRODUCTION', 'DD', 'OFFER', 'NEGOTIATION', 'CLOSING', 'FEE MATURITY', 'INVOICE', 'PAYMENT', 'STOP'];
  return `<div class="workflow">${steps.map((step, index) => `${index ? '<span class="arrow">→</span>' : ''}<span class="step">${esc(step)}</span>`).join('')}</div>`;
}

function masterPage() {
  const { deals } = loadState();

  const pipelineDeals =
    deals.filter(
      ({ cycle }) =>
        isDealPipelineEligible(cycle)
    );

  const excludedCount =
    deals.length - pipelineDeals.length;

  const counts = {
    total: pipelineDeals.length,
    evaluationPending: pipelineDeals.filter((d) => d.control.evaluation === 'PENDING').length,
    evaluationYes: pipelineDeals.filter((d) => d.control.evaluation === 'YES').length,
    evaluationNo: pipelineDeals.filter((d) => d.control.evaluation === 'NO').length,
    agreementPassed: pipelineDeals.filter((d) => d.control.agreementGate === 'PASSED').length,
    authorized: pipelineDeals.filter((d) => d.productionAuthorized).length,
  };

  const rows = pipelineDeals.map(({ cycle, control, productionAuthorized }) => `
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
<header><div class="kicker">WALLTECH OPERATING SYSTEM</div><h1>Deal Workflow Control</h1><div class="meta">Filiera standard universale · Evaluation prima della produzione · Agreement Gate prima della produzione significativa</div><div class="nav"><a href="/">Deal Control</a><a href="/reconciliation">Reconciliation Inbox</a><a href="/reports">Report Collaboratori</a></div></header>
${workflowRibbon()}
<div class="meta">
${excludedCount} cicli operativi non-Deal esclusi da questa vista.
</div>
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

  const management =
    readManagementOutput(
      cycle.dealId
    );

  const managementLatestText =
    management?.latestUpdate
      ? [
          management.latestUpdate.occurredAt,
          management.latestUpdate.direction,
          management.latestUpdate.subject,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;
  const people = (control.participants || []).map((p) => `<div class="person"><div class="tiny">${esc(p.role)}</div><strong>${esc(p.name || p.email || 'Unnamed')}</strong><div>${esc(p.email || 'email non definita')}</div><div class="tiny">Report: ${p.reportAccess ? 'YES' : 'NO'} · Lingua: ${esc(reportLanguageLabel(p.reportLanguage || 'it'))} · Fee: ${money(p.feeValue, control.currency)} · ${esc(p.feeStatus || 'UNDEFINED')}</div></div>`).join('') || '<div class="meta">Nessun partecipante definito.</div>';
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

<div class="field"><label>EVALUATION DECISION</label>${select('evaluation', EVALUATION, control.evaluation)}</div>
<div class="field"><label>WORKFLOW STAGE</label>${select('workflowStage', WORKFLOW, control.workflowStage)}</div>
<div class="field"><label>AGREEMENT GATE</label>${select('agreementGate', AGREEMENT, control.agreementGate)}</div>

<div class="span3">
  <h3 style="color:var(--navy);margin:8px 0 2px">
    Evaluation Gate
  </h3>
  <div class="tiny">
    Tutti i criteri devono essere CONFIRMED prima che EVALUATION possa diventare YES.
  </div>
</div>

<div class="field">
<label>PRODUCT</label>
${select('evaluationProduct', CHECK_STATUS, control.evaluationProduct)}
</div>

<div class="field">
<label>REALITY / EVIDENCE</label>
${select('evaluationReality', CHECK_STATUS, control.evaluationReality)}
</div>

<div class="field">
<label>COUNTERPARTIES</label>
${select('evaluationCounterparties', CHECK_STATUS, control.evaluationCounterparties)}
</div>

<div class="field">
<label>WALLTECH ROLE</label>
${select('evaluationWalltechRole', CHECK_STATUS, control.evaluationWalltechRole)}
</div>

<div class="field">
<label>MONETIZATION MODEL</label>
${select('evaluationMonetization', CHECK_STATUS, control.evaluationMonetization)}
</div>

<div class="field">
<label>POTENTIAL FEE PAYER</label>
${select('evaluationFeePayer', CHECK_STATUS, control.evaluationFeePayer)}
</div>

<div class="field">
<label>TIME TO REVENUE</label>
${select('evaluationTimeToRevenue', CHECK_STATUS, control.evaluationTimeToRevenue)}
</div>

<div class="field">
<label>RESOURCE COST</label>
${select('evaluationResourceCost', CHECK_STATUS, control.evaluationResourceCost)}
</div>

<div class="field">
<label>COMPLIANCE</label>
${select('evaluationCompliance', CHECK_STATUS, control.evaluationCompliance)}
</div>

<div class="field"><label>DEAL VALUE</label><input name="dealValue" value="${esc(control.dealValue ?? '')}" inputmode="decimal"></div>
<div class="field"><label>WALLTECH FEE</label><input name="walltechFee" value="${esc(control.walltechFee ?? '')}" inputmode="decimal"></div>
<div class="field"><label>FEE STATUS</label>${select('feeStatus', FEE_STATUS, control.feeStatus)}</div>
<div class="field span3"><label>EVALUATION REASON / WHY</label><textarea name="evaluationReason">${esc(control.evaluationReason || '')}</textarea></div>
<div class="field span3"><label>MISSING TO ADVANCE</label><textarea name="missingToAdvance">${esc(
  management?.currentBlocker ??
  control.missingToAdvance ??
  ''
)}</textarea></div>
<div class="field span3"><label>NEXT ACTION</label><textarea name="nextAction">${esc(
  management?.nextAction ??
  control.nextAction ??
  ''
)}</textarea></div>
<div class="field"><button type="submit">SALVA CONTROLLO DEAL</button></div>
</div></form></section>
<section>
<h2>Management Output — Evidence Bound</h2>

${
  management
    ? `
<div class="good-note">
  MANAGEMENT ENGINE ·
  ${esc(management.inferencePolicy || '—')}
</div>

<p>
  <strong>LATEST UPDATE:</strong><br>
  ${esc(managementLatestText || 'NOT PROVEN')}
</p>

<p>
  <strong>CURRENT BLOCKER:</strong><br>
  ${esc(management.currentBlocker || 'NOT PROVEN')}
  <div class="tiny">
    BASIS:
    ${esc(management.currentBlockerBasis || 'NOT_PROVEN')}
  </div>
</p>

<p>
  <strong>NEXT ACTION:</strong><br>
  ${esc(management.nextAction || 'NOT PROVEN')}
  <div class="tiny">
    BASIS:
    ${esc(management.nextActionBasis || 'NOT_PROVEN')}
  </div>
</p>

<p>
  <strong>LAST VERIFIED EVIDENCE:</strong><br>
  ${esc(
    management.lastVerifiedEvidence?.occurredAt ||
    'NOT PROVEN'
  )}
  <div class="tiny">
    BASIS:
    ${esc(
      management.lastVerifiedEvidence?.bindingSource ||
      'NOT_PROVEN'
    )}
  </div>
</p>

<p class="tiny">
  CONFIRMED MAIL EVIDENCE:
  ${esc(management.confirmedMailEvidenceCount ?? 0)}
</p>
`
    : `
<div class="meta">
  Management Output non ancora disponibile per questo Deal.
</div>
`
}
</section>
</div>
<section><h2>Deal Organigram</h2><div class="people">${people}</div></section>
<section><h2>Aggiungi / aggiorna partecipante</h2><form method="post" action="/control/participant"><input type="hidden" name="dealId" value="${esc(cycle.dealId)}"><div class="form-grid">
<div class="field"><label>NOME</label><input name="name"></div>
<div class="field"><label>EMAIL — chiave report</label><input name="email" type="email" required></div>
<div class="field"><label>RUOLO</label>${select('role', ROLES, 'COLLABORATOR')}</div>
<div class="field"><label>REPORT ACCESS</label><select name="reportAccess"><option value="NO">NO</option><option value="YES">YES</option></select></div>

<div class="field">
<label>REPORT LANGUAGE</label>
${reportLanguageSelect(
  'reportLanguage',
  'it'
)}
</div>

<div class="field"><label>FEE PERSONA</label><input name="feeValue" inputmode="decimal"></div>
<div class="field"><label>FEE TYPE</label><input name="feeType" placeholder="% / FIXED / OTHER"></div>
<div class="field"><label>FEE STATUS</label>${select('participantFeeStatus', FEE_STATUS, 'UNDEFINED')}</div>
<div class="field"><button type="submit">SALVA PARTECIPANTE</button></div>
</div></form></section>`);
}


function reconciliationPage() {
  const reconciliationDir =
    path.join(
      ROOT,
      'runtime/state/generic-reconciliation'
    );

  const result =
    readJson(
      path.join(
        reconciliationDir,
        'result.json'
      ),
      null
    );

  const audit =
    readJson(
      path.join(
        reconciliationDir,
        'candidate-audit.json'
      ),
      []
    );

  if (!result) {
    return layout(
      'Walltech — Reconciliation Inbox',
      `
<header>
  <div class="kicker">WALLTECH INTELLIGENCE</div>
  <h1>Reconciliation Inbox</h1>
  <div class="nav">
    <a href="/">← Deal Workflow</a>
  </div>
</header>
<section>
  <h2>Nessun risultato disponibile</h2>
  <p>Il Generic Evidence Reconciliation non ha ancora prodotto un result.json.</p>
</section>
`
    );
  }

  const decisions =
    Array.isArray(result.decisions)
      ? result.decisions
      : [];

  const possible =
    decisions.filter(
      (d) =>
        d.reconciliationOutcome ===
        'POSSIBLE_MATCH'
    );

  const auditByEvidence =
    new Map(
      (Array.isArray(audit) ? audit : [])
        .filter(
          (item) =>
            item &&
            item.evidenceId
        )
        .map(
          (item) => [
            item.evidenceId,
            item,
          ]
        )
    );

  const reviewStore =
    readJson(
      RECONCILIATION_REVIEW_FILE,
      {
        version: 1,
        updatedAt: null,
        reviews: {},
      }
    );

  reviewStore.reviews =
    reviewStore.reviews || {};

  const cycles =
    readCycles();

  const cycleById =
    new Map(
      cycles.map(
        (cycle) => [
          cycle.dealId,
          cycle,
        ]
      )
    );

  const rows =
    possible
      .map(
        (decision) => {
          const evidence =
            auditByEvidence.get(
              decision.evidenceRef
            ) || {};

          const candidateIds =
            Array.isArray(
              decision.candidateOpportunityIds
            )
              ? decision.candidateOpportunityIds
              : [];

          const candidates =
            candidateIds
              .map(
                (id) => {
                  const cycle =
                    cycleById.get(id);

                  if (!cycle) {
                    return esc(id);
                  }

                  return `<a href="/deal?id=${encodeURIComponent(id)}"><strong>${esc(cycle.dealName)}</strong></a><div class="tiny">${esc(id)}</div>`;
                }
              )
              .join('<br><br>');

          const auditMatches =
            Array.isArray(
              evidence.candidates
            )
              ? evidence.candidates
              : [];

          const bases =
            [
              ...new Set(
                auditMatches
                  .map(
                    (item) =>
                      item.matchBasis
                  )
                  .filter(Boolean)
              ),
            ]
              .map(esc)
              .join('<br>');

          return `
<tr>
  <td>
    <strong>${esc(evidence.subject || '—')}</strong>
    <div class="tiny">${esc(decision.evidenceRef)}</div>
  </td>
  <td>${candidates || '—'}</td>
  <td>${bases || esc(decision.reasonCode || '—')}</td>
  <td>${badge('POSSIBLE_MATCH')}</td>
  <td>
    ${
      (() => {
        const review =
          reviewStore.reviews[
            decision.evidenceRef
          ] || {
            confirmedOpportunityId: null,
            rejectedOpportunityIds: [],
          };

        if (
          review.confirmedOpportunityId
        ) {
          return `
            <strong class="good-note">
              CONFIRMED →
              ${esc(review.confirmedOpportunityId)}
            </strong>
            <div class="tiny">
              Decisione Max registrata.
              Deal non ancora mutato.
            </div>
          `;
        }

        return candidateIds
          .map(
            (candidateId) => {
              const rejected =
                Array.isArray(
                  review.rejectedOpportunityIds
                ) &&
                review.rejectedOpportunityIds
                  .includes(candidateId);

              if (rejected) {
                return `
                  <div class="bad-note">
                    REJECTED · ${esc(candidateId)}
                  </div>
                `;
              }

              return `
                <div style="margin-bottom:8px">
                  <form
                    method="post"
                    action="/reconciliation/review"
                    style="display:inline"
                  >
                    <input
                      type="hidden"
                      name="evidenceRef"
                      value="${esc(decision.evidenceRef)}"
                    >
                    <input
                      type="hidden"
                      name="opportunityId"
                      value="${esc(candidateId)}"
                    >
                    <input
                      type="hidden"
                      name="reviewAction"
                      value="CONFIRM"
                    >
                    <button type="submit">
                      CONFIRM ${esc(candidateId)}
                    </button>
                  </form>

                  <form
                    method="post"
                    action="/reconciliation/review"
                    style="display:inline"
                  >
                    <input
                      type="hidden"
                      name="evidenceRef"
                      value="${esc(decision.evidenceRef)}"
                    >
                    <input
                      type="hidden"
                      name="opportunityId"
                      value="${esc(candidateId)}"
                    >
                    <input
                      type="hidden"
                      name="reviewAction"
                      value="REJECT"
                    >
                    <button type="submit">
                      REJECT
                    </button>
                  </form>
                </div>
              `;
            }
          )
          .join('');
      })()
    }

    <div class="tiny">
      MAX REVIEW REQUIRED<br>
      CRM WRITE = NO
    </div>
  </td>
</tr>`;
        }
      )
      .join('');

  const counts =
    result.counts || {};

  return layout(
    'Walltech — Reconciliation Inbox',
    `
<header>
  <div class="kicker">WALLTECH INTELLIGENCE</div>
  <h1>Reconciliation Inbox</h1>
  <div class="meta">
    Evidence-bound review · No automatic Deal mutation
  </div>
  <div class="nav">
    <a href="/">← Deal Workflow</a>
    <a href="/reports">Report Collaboratori</a>
  </div>
</header>

<div class="cards">
  <div class="card">
    <div class="label">Input Events</div>
    <div class="value">${esc(counts.inputEvents ?? decisions.length)}</div>
  </div>

  <div class="card">
    <div class="label">Possible Match</div>
    <div class="value">${esc(counts.possibleMatches ?? possible.length)}</div>
  </div>

  <div class="card">
    <div class="label">New Candidates</div>
    <div class="value">${esc(counts.newCandidates ?? 0)}</div>
  </div>

  <div class="card">
    <div class="label">Exact Duplicates</div>
    <div class="value">${esc(counts.exactDuplicates ?? 0)}</div>
  </div>
</div>

<section>
  <h2>Possible Match da verificare</h2>

  <div class="good-note">
    Il motore propone associazioni, ma NON modifica automaticamente Deal, CRM o stato commerciale.
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Email / Evidence</th>
          <th>Deal candidato</th>
          <th>Match Basis</th>
          <th>Outcome</th>
          <th>Gate</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows ||
          '<tr><td colspan="5">Nessun POSSIBLE_MATCH disponibile.</td></tr>'
        }
      </tbody>
    </table>
  </div>
</section>

<section>
  <div class="tiny">
    Reconciliation ID:
    ${esc(result.reconciliationId || '—')}
    · CRM WRITE = NO
    · AUTO LINK = NO
  </div>
</section>
`
  );
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
  const email =
    String(emailInput || '')
      .trim()
      .toLowerCase();

  const { deals } =
    loadState();

  const matched = [];

  let displayName =
    email;

  for (const item of deals) {
    const participant =
      (
        item.control.participants || []
      ).find(
        (p) =>
          String(
            p.email || ''
          )
            .trim()
            .toLowerCase() === email &&
          p.reportAccess
      );

    if (!participant) {
      continue;
    }

    const management =
      readManagementOutput(
        item.cycle.dealId
      );

    displayName =
      participant.name ||
      displayName;

    matched.push({
      ...item,
      participant,
      management,
    });
  }

  const totalFee =
    matched.reduce(
      (sum, item) =>
        sum +
        (
          Number.isFinite(
            Number(
              item.participant.feeValue
            )
          )
            ? Number(
                item.participant.feeValue
              )
            : 0
        ),
      0
    );

  const actionRequired =
    matched.filter(
      ({ control, management }) =>
        Boolean(
          management?.nextAction ??
          control.nextAction
        )
    ).length;

  const rows =
    matched
      .map(
        ({
          cycle,
          control,
          participant,
          management,
        }) => {
          const latest =
            management?.latestUpdate
              ? [
                  management.latestUpdate.occurredAt,
                  management.latestUpdate.direction,
                  management.latestUpdate.subject,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'NOT PROVEN';

          const blocker =
            management?.currentBlocker ??
            control.missingToAdvance ??
            'NOT PROVEN';

          const nextAction =
            management?.nextAction ??
            control.nextAction ??
            'NOT PROVEN';

          const lastVerified =
            management
              ?.lastVerifiedEvidence
              ?.occurredAt ??
            cycle.lastEvidenceAt ??
            'NOT PROVEN';

          const source =
            management
              ?.inferencePolicy ??
            'LEGACY_CONTROL_FALLBACK';

          return `
<tr>
  <td>
    <a href="/deal?id=${encodeURIComponent(cycle.dealId)}">
      <strong>${esc(cycle.dealName)}</strong>
    </a>
    <div class="tiny">
      ${esc(cycle.dealId)}
    </div>
  </td>

  <td>
    ${esc(latest)}
  </td>

  <td>
    ${esc(blocker)}
  </td>

  <td>
    <strong>
      ${esc(nextAction)}
    </strong>
  </td>

  <td>
    ${esc(lastVerified)}
    <div class="tiny">
      ${esc(source)}
    </div>
  </td>

  <td>
    ${money(
      control.dealValue,
      control.currency
    )}
  </td>

  <td>
    ${money(
      participant.feeValue,
      control.currency
    )}
    <div class="tiny">
      ${esc(
        participant.feeStatus ||
        'UNDEFINED'
      )}
    </div>
  </td>
</tr>`;
        }
      )
      .join('');

  return layout(
    `Walltech — Report ${displayName}`,
    `
<header>
  <div class="kicker">
    WALLTECH · REPORT COLLABORATORE
  </div>

  <h1>
    ${esc(displayName || email)}
  </h1>

  <div class="meta">
    ${esc(email)} · Generated ${esc(nowIso())}
  </div>

  <div class="nav">
    <a href="/reports">
      ← Report Collaboratori
    </a>
  </div>
</header>

<div class="cards">
  <div class="card">
    <div class="label">
      Deal
    </div>
    <div class="value">
      ${matched.length}
    </div>
  </div>

  <div class="card">
    <div class="label">
      Fee assegnate
    </div>
    <div class="value">
      ${money(totalFee, 'EUR')}
    </div>
  </div>

  <div class="card">
    <div class="label">
      Action Required
    </div>
    <div class="value">
      ${actionRequired}
    </div>
  </div>
</div>

<section>
  <h2>
    Management Preview — Evidence Bound
  </h2>

  <div class="good-note">
    Fonte operativa:
    runtime/state/management-output
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Deal</th>
          <th>Latest Update</th>
          <th>Current Blocker</th>
          <th>Next Action</th>
          <th>Last Verified Evidence</th>
          <th>Deal Value</th>
          <th>Fee assegnata</th>
        </tr>
      </thead>

      <tbody>
        ${
          rows ||
          `
<tr>
  <td colspan="7">
    Nessun deal autorizzato.
  </td>
</tr>
`
        }
      </tbody>
    </table>
  </div>
</section>

<section>
  <div class="tiny">
    PREVIEW ONLY ·
    SEND ENABLED = NO ·
    MAX APPROVAL REQUIRED ·
    MANAGEMENT SOURCE =
    EVIDENCE-BOUND
  </div>
</section>
`
  );
}

function readRawBody(
  req,
  maxBytes = 1_000_000
) {
  return new Promise(
    (resolve, reject) => {
      const chunks = [];
      let total = 0;
      let settled = false;

      function fail(error) {
        if (settled) return;
        settled = true;
        reject(error);
      }

      req.on(
        'data',
        chunk => {
          if (settled) return;

          const buffer =
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk);

          total += buffer.length;

          if (total > maxBytes) {
            fail(
              new Error(
                'CALENDLY WEBHOOK BODY TOO LARGE'
              )
            );

            req.destroy();
            return;
          }

          chunks.push(buffer);
        }
      );

      req.on(
        'end',
        () => {
          if (settled) return;

          settled = true;

          resolve(
            Buffer.concat(chunks)
          );
        }
      );

      req.on(
        'error',
        fail
      );
    }
  );
}

function jsonResponse(
  res,
  statusCode,
  value
) {
  res.writeHead(
    statusCode,
    {
      'Content-Type':
        'application/json; charset=utf-8',
      'Cache-Control':
        'no-store',
      'X-Content-Type-Options':
        'nosniff',
    }
  );

  res.end(
    JSON.stringify(value)
  );
}

async function handleCalendlyLeadPost(
  req,
  res
) {
  const signingKey =
    String(
      process.env
        .CALENDLY_WEBHOOK_SIGNING_KEY ||
      ''
    ).trim();

  const allowedRoutingFormIds =
    String(
      process.env
        .CALENDLY_ALLOWED_ROUTING_FORM_IDS ||
      ''
    )
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

  if (
    !signingKey ||
    allowedRoutingFormIds.length === 0
  ) {
    jsonResponse(
      res,
      503,
      {
        ok: false,
        status:
          'CALENDLY_INGRESS_NOT_CONFIGURED',
      }
    );

    return;
  }

  let rawBody;

  try {
    rawBody =
      await readRawBody(req);
  } catch (error) {
    const statusCode =
      /TOO LARGE/i.test(
        error.message || ''
      )
        ? 413
        : 400;

    jsonResponse(
      res,
      statusCode,
      {
        ok: false,
        status:
          'REQUEST_BODY_REJECTED',
      }
    );

    return;
  }

  const signatureHeader =
    req.headers[
      'calendly-webhook-signature'
    ];

  const rootDir =
    String(
      process.env
        .WALLTECH_LEAD_EVIDENCE_ROOT ||
      ''
    ).trim() ||
    path.join(
      ROOT,
      'runtime/state/lead-evidence'
    );

  try {
    const result =
      ingestCalendlyWebhook({
        signatureHeader,
        signingKey,
        rawBody,
        rootDir,
        allowedRoutingFormIds,
      });

    jsonResponse(
      res,
      result.status === 'CREATED'
        ? 201
        : 200,
      {
        ok: true,
        status:
          result.status,
      }
    );
  } catch (error) {
    const message =
      String(
        error.message || ''
      );

    let statusCode = 422;

    if (
      /SIGNATURE|REJECTED|TIMESTAMP/i
        .test(message)
    ) {
      statusCode = 401;
    } else if (
      /NOT ALLOWED/i.test(message)
    ) {
      statusCode = 403;
    } else if (
      /INVALID JSON|EVENT NOT SUPPORTED|PAYLOAD MISSING|ROUTING FORM ID MISSING/i
        .test(message)
    ) {
      statusCode = 400;
    }

    console.error(
      'CALENDLY LEAD INGRESS:',
      message
    );

    jsonResponse(
      res,
      statusCode,
      {
        ok: false,
        status:
          'CALENDLY_WEBHOOK_REJECTED',
      }
    );
  }
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
  if (
    pathname === '/api/lead/calendly'
  ) {
    return await handleCalendlyLeadPost(
      req,
      res
    );
  }

  const form = await parseBody(req);

  if (
    pathname === '/reconciliation/review'
  ) {
    const evidenceRef =
      String(
        form.get('evidenceRef') || ''
      ).trim();

    const opportunityId =
      String(
        form.get('opportunityId') || ''
      ).trim();

    const reviewAction =
      String(
        form.get('reviewAction') || ''
      ).trim()
      .toUpperCase();

    if (
      !evidenceRef ||
      !opportunityId ||
      !['CONFIRM', 'REJECT']
        .includes(reviewAction)
    ) {
      res.writeHead(400);
      res.end(
        'Invalid reconciliation review request'
      );
      return;
    }

    const result =
      readJson(
        path.join(
          RECONCILIATION_DIR,
          'result.json'
        ),
        null
      );

    if (!result) {
      res.writeHead(409);
      res.end(
        'No reconciliation result available'
      );
      return;
    }

    const decision =
      (result.decisions || [])
        .find(
          (item) =>
            item.evidenceRef ===
              evidenceRef &&
            item.reconciliationOutcome ===
              'POSSIBLE_MATCH'
        );

    if (!decision) {
      res.writeHead(409);
      res.end(
        'Evidence is not a current POSSIBLE_MATCH'
      );
      return;
    }

    const candidates =
      Array.isArray(
        decision.candidateOpportunityIds
      )
        ? decision.candidateOpportunityIds
        : [];

    if (
      !candidates.includes(
        opportunityId
      )
    ) {
      res.writeHead(409);
      res.end(
        'Opportunity is not a candidate for this evidence'
      );
      return;
    }

    const store =
      readJson(
        RECONCILIATION_REVIEW_FILE,
        {
          version: 1,
          updatedAt: null,
          reviews: {},
        }
      );

    store.reviews =
      store.reviews || {};

    const review =
      store.reviews[evidenceRef] || {
        evidenceRef,
        confirmedOpportunityId:
          null,
        rejectedOpportunityIds:
          [],
        updatedAt:
          null,
      };

    review.rejectedOpportunityIds =
      Array.isArray(
        review.rejectedOpportunityIds
      )
        ? review.rejectedOpportunityIds
        : [];

    if (
      reviewAction === 'CONFIRM'
    ) {
      review.confirmedOpportunityId =
        opportunityId;

      review.rejectedOpportunityIds =
        review.rejectedOpportunityIds
          .filter(
            id =>
              id !== opportunityId
          );
    }

    if (
      reviewAction === 'REJECT'
    ) {
      if (
        review.confirmedOpportunityId ===
        opportunityId
      ) {
        review.confirmedOpportunityId =
          null;
      }

      if (
        !review.rejectedOpportunityIds
          .includes(opportunityId)
      ) {
        review.rejectedOpportunityIds
          .push(opportunityId);
      }
    }

    review.updatedAt =
      nowIso();

    store.reviews[evidenceRef] =
      review;

    store.updatedAt =
      nowIso();

    writeJsonAtomic(
      RECONCILIATION_REVIEW_FILE,
      store
    );

    redirect(
      res,
      '/reconciliation'
    );

    return;
  }

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

    for (const [key] of EVALUATION_CRITERIA) {
      const value = form.get(key);

      if (CHECK_STATUS.includes(value)) {
        c[key] = value;
      }
    }

    if (EVALUATION.includes(evaluation)) c.evaluation = evaluation;
    if (WORKFLOW.includes(workflowStage)) c.workflowStage = workflowStage;
    if (AGREEMENT.includes(agreementGate)) c.agreementGate = agreementGate;
    if (FEE_STATUS.includes(feeStatus)) c.feeStatus = feeStatus;
    c.dealValue = numberOrNull(form.get('dealValue'));
    c.walltechFee = numberOrNull(form.get('walltechFee'));
    c.evaluationReason = form.get('evaluationReason') || '';

    const missingEvaluation =
      evaluationMissing(c);

    if (
      c.evaluation === 'YES' &&
      missingEvaluation.length > 0
    ) {
      c.evaluation = 'PENDING';

      c.missingToAdvance =
        `Evaluation Gate incomplete: ${
          missingEvaluation.join(', ')
        }.`;

      c.nextAction =
        `Complete Evaluation evidence for: ${
          missingEvaluation.join(', ')
        }.`;
    } else {
      c.missingToAdvance =
        form.get('missingToAdvance') || '';

      c.nextAction =
        form.get('nextAction') || '';
    }

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
    const reportAccess =
      form.get('reportAccess') === 'YES';

    const requestedLanguage =
      String(
        form.get('reportLanguage') || 'it'
      ).trim();

    const reportLanguage =
      REPORT_LANGUAGES.some(
        ([code]) =>
          code === requestedLanguage
      )
        ? requestedLanguage
        : 'it';

    const feeStatus =
      form.get('participantFeeStatus');
    const existing = (c.participants || []).find((p) => String(p.email || '').trim().toLowerCase() === email);
    const data = {
      name: form.get('name') || email,
      email,
      role: ROLES.includes(role) ? role : 'OTHER',
      reportAccess,
      reportLanguage,
      feeValue: numberOrNull(form.get('feeValue')),
      feeType: form.get('feeType') || '',
      feeStatus: FEE_STATUS.includes(feeStatus) ? feeStatus : 'UNDEFINED',
    };
    if (existing) {
      Object.assign(
        existing,
        data
      );
    } else {
      c.participants.push(
        data
      );
    }

    store.recipientPreferences[email] = {
      reportLanguage,
      updatedAt: nowIso(),
    };

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
    else if (url.pathname === '/reconciliation') html = reconciliationPage();
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

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`WALLTECH DEAL PRODUCT: LIVE http://${HOST}:${PORT}/`);
    console.log(`CONTROL FILE: ${CONTROL_FILE}`);
    console.log('AUTO EMAIL SEND: NONE');
    console.log('HUBSPOT WRITE: NONE');
  });
}

module.exports = {
  isDealPipelineEligible,
  server,
};
