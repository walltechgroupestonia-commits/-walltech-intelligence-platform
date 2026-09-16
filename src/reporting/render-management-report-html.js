const fs = require("node:fs");
const path = require("node:path");

function esc(value) {
  return String(
    value ?? "-"
  )
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusClass(value) {
  if (value === "OUT_OF_CONTROL") return "danger";
  if (value === "ACTION_REQUIRED") return "action";
  if (value === "BLOCKED") return "danger";
  if (value === "WAITING_EXTERNAL") return "waiting";
  if (value === "IN_CONTROL") return "ok";
  return "neutral";
}

function baseHtml(title, body) {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{
  --bg:#f3f6f8;
  --card:#ffffff;
  --ink:#172630;
  --muted:#66737c;
  --line:#dce4e9;
  --blue:#173d59;
  --accent:#17698c;
  --danger:#9d2b2b;
  --action:#a65f00;
  --waiting:#536e7c;
  --ok:#2d6b43;
}
*{box-sizing:border-box}
body{
  margin:0;
  background:var(--bg);
  color:var(--ink);
  font-family:Arial,Helvetica,sans-serif;
}
main{
  max-width:1440px;
  margin:0 auto;
  padding:28px;
}
header{
  margin-bottom:24px;
}
.kicker{
  color:var(--accent);
  font-size:12px;
  font-weight:700;
  letter-spacing:.15em;
}
h1{
  margin:8px 0 6px;
  font-size:31px;
  color:var(--blue);
}
.meta{
  color:var(--muted);
  font-size:13px;
}
.cards{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(145px,1fr));
  gap:10px;
  margin:20px 0;
}
.card{
  background:var(--card);
  border:1px solid var(--line);
  padding:14px;
}
.card .label{
  font-size:11px;
  color:var(--muted);
  text-transform:uppercase;
  letter-spacing:.08em;
}
.card .value{
  margin-top:7px;
  font-size:22px;
  font-weight:700;
  color:var(--blue);
}
section{
  background:var(--card);
  border:1px solid var(--line);
  padding:18px;
  margin-top:16px;
}
h2{
  margin:0 0 14px;
  font-size:18px;
  color:var(--blue);
}
table{
  width:100%;
  border-collapse:collapse;
  font-size:12px;
}
th{
  text-align:left;
  background:var(--blue);
  color:#fff;
  padding:9px 8px;
}
td{
  border-bottom:1px solid var(--line);
  padding:9px 8px;
  vertical-align:top;
  line-height:1.35;
}
.badge{
  display:inline-block;
  padding:3px 7px;
  border-radius:999px;
  font-size:10px;
  font-weight:700;
  white-space:nowrap;
}
.danger{background:#f8dddd;color:var(--danger)}
.action{background:#fff0d9;color:var(--action)}
.waiting{background:#e9eff2;color:var(--waiting)}
.ok{background:#e1f1e7;color:var(--ok)}
.neutral{background:#edf1f3;color:#58636a}
.next{
  font-weight:700;
}
.delivery{
  color:var(--muted);
  font-size:12px;
}
a{
  color:var(--accent);
  font-weight:700;
  text-decoration:none;
}
a:hover{text-decoration:underline}
.nav{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin-top:12px;
}
.nav a{
  display:inline-block;
  border:1px solid var(--line);
  background:#fff;
  padding:8px 10px;
}
@media(max-width:900px){
  main{padding:15px}
  .table-wrap{overflow:auto}
  table{min-width:1100px}
}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function cards(counts) {
  const items = [
    ["Cicli", counts.total],
    ["START", counts.start],
    ["CHANGE", counts.change],
    ["STOP", counts.stop],
    ["OUT OF CONTROL", counts.outOfControl],
    ["ACTION REQUIRED", counts.actionRequired],
    ["BLOCKED", counts.blocked],
    ["WAITING EXTERNAL", counts.waitingExternal],
  ];

  return `<div class="cards">${
    items.map(([label, value]) =>
      `<div class="card">
        <div class="label">${esc(label)}</div>
        <div class="value">${esc(value)}</div>
      </div>`
    ).join("")
  }</div>`;
}

function cycleTable(rows) {
  return `<div class="table-wrap">
<table>
<thead>
<tr>
<th>Ciclo</th>
<th>Phase</th>
<th>Control</th>
<th>Stato</th>
<th>Ultimo DONE / Update</th>
<th>Missing / Blocker</th>
<th>Next Action</th>
<th>Freshness</th>
</tr>
</thead>
<tbody>
${
  rows.map(row => {
    const missing = [
      ...(row.missing ?? []),
      row.blocker,
    ].filter(Boolean).join("; ") || "-";

    const update =
      row.latestDone
        ? `DONE: ${row.latestDone}`
        : row.latestUpdate;

    const control =
      row.overdue
        ? `${row.effectiveControlStatus} — OVERDUE ${row.overdueHours}h`
        : row.effectiveControlStatus;

    return `<tr>
<td><strong>${esc(row.cycleName)}</strong></td>
<td>${esc(row.lifecyclePhase)}</td>
<td><span class="badge ${statusClass(row.effectiveControlStatus)}">${esc(control)}</span></td>
<td>${esc(row.commercialStatus)}</td>
<td>${esc(update)}</td>
<td>${esc(missing)}</td>
<td class="next">${esc(row.nextAction)}</td>
<td>${esc(row.freshness)}</td>
</tr>`;
  }).join("")
}
</tbody>
</table>
</div>`;
}

function renderMaster(report, collaboratorReports) {
  const links =
    collaboratorReports.length
      ? `<div class="nav">${
          collaboratorReports.map(item =>
            `<a href="individual/${encodeURIComponent(item.collaborator.collaboratorId)}.html">${esc(item.collaborator.displayName)}</a>`
          ).join("")
        }</div>`
      : `<p class="meta">Nessun report collaboratore corrente.</p>`;

  const body = `
<header>
<div class="kicker">WALLTECH OPERATING SYSTEM</div>
<h1>Max Master Production Report</h1>
<div class="meta">
Generato: ${esc(report.generatedAt)} · As of: ${esc(report.asOf)}
</div>
</header>

${cards(report.counts)}

<section>
<h2>Cicli operativi</h2>
${cycleTable(report.cycles)}
</section>

<section>
<h2>Report collaboratori</h2>
${links}
</section>

<section class="delivery">
<strong>Delivery Control:</strong>
SEND ENABLED = NO · INTERNAL MAX MASTER
</section>
`;

  return baseHtml(
    "Walltech — Max Master Production Report",
    body
  );
}

function renderCollaboratorIndex(
  collaboratorReports
) {
  const reportCards =
    collaboratorReports.length
      ? collaboratorReports
          .map(report => {
            const collaborator =
              report.collaborator;

            const firstCycle =
              report.cycles?.[0];

            const nextAction =
              firstCycle?.nextAction ??
              "Nessuna azione corrente.";

            return `
<a
  class="card"
  style="display:block;text-decoration:none"
  href="individual/${encodeURIComponent(
    collaborator.collaboratorId
  )}.html"
>
  <div class="label">
    COLLABORATORE
  </div>

  <div
    class="value"
    style="font-size:18px"
  >
    ${esc(collaborator.displayName)}
  </div>

  <div
    class="meta"
    style="margin-top:10px"
  >
    Cicli: ${esc(report.counts.total)}
    · Action required:
    ${esc(report.counts.actionRequired)}
  </div>

  <div
    style="
      margin-top:12px;
      font-size:12px;
      line-height:1.4;
      color:var(--ink)
    "
  >
    <strong>Next Action:</strong>
    ${esc(nextAction)}
  </div>
</a>`;
          })
          .join("")
      : `
<section>
  <strong>
    Nessun collaboratore con report operativo corrente.
  </strong>
</section>`;

  const body = `
<header>
  <div class="kicker">
    WALLTECH OPERATING SYSTEM
  </div>

  <h1>
    Report Collaboratori
  </h1>

  <div class="meta">
    Report operativi individuali ·
    solo collaboratori con cicli autorizzati
  </div>
</header>

<div class="cards">
  ${reportCards}
</div>

<section class="delivery">
  <strong>Delivery Control:</strong>
  SEND ENABLED = NO ·
  MAX EXPLICIT APPROVAL REQUIRED
</section>
`;

  return baseHtml(
    "Walltech — Report Collaboratori",
    body
  );
}


function renderCollaborator(report) {
  const body = `
<header>
<div class="kicker">WALLTECH · REPORT COLLABORATORE</div>
<h1>${esc(report.collaborator.displayName)}</h1>
<div class="meta">
Generato: ${esc(report.generatedAt)} · As of: ${esc(report.asOf)}
</div>
<div class="nav">
<a href="../index.html">← Max Master Report</a>
</div>
</header>

${cards(report.counts)}

<section>
<h2>Cicli assegnati</h2>
${cycleTable(report.cycles)}
</section>

<section class="delivery">
<strong>Delivery Control:</strong>
SEND ENABLED = NO · EMAIL = NONE · MAX EXPLICIT APPROVAL REQUIRED = YES
</section>
`;

  return baseHtml(
    `Walltech — Report ${report.collaborator.displayName}`,
    body
  );
}

function writeHtmlProduct(reportSet, outputDir) {
  fs.mkdirSync(
    outputDir,
    { recursive: true }
  );

  const individualDir =
    path.join(
      outputDir,
      "individual"
    );

  fs.mkdirSync(
    individualDir,
    { recursive: true }
  );

  const collaboratorProductDir =
    path.join(
      outputDir,
      "collaborators"
    );

  const collaboratorIndividualDir =
    path.join(
      collaboratorProductDir,
      "individual"
    );

  fs.mkdirSync(
    collaboratorIndividualDir,
    { recursive: true }
  );

  fs.writeFileSync(
    path.join(
      outputDir,
      "index.html"
    ),
    renderMaster(
      reportSet.maxReport,
      reportSet.collaboratorReports
    ),
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );

  fs.writeFileSync(
    path.join(
      collaboratorProductDir,
      "index.html"
    ),
    renderCollaboratorIndex(
      reportSet.collaboratorReports
    ),
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );


  for (
    const report
    of reportSet.collaboratorReports
  ) {
    fs.writeFileSync(
      path.join(
        individualDir,
        `${report.collaborator.collaboratorId}.html`
      ),
      renderCollaborator(
        report
      ),
      {
        encoding: "utf8",
        mode: 0o600,
      }
    );

    fs.writeFileSync(
      path.join(
        collaboratorIndividualDir,
        `${report.collaborator.collaboratorId}.html`
      ),
      renderCollaborator(
        report
      ),
      {
        encoding: "utf8",
        mode: 0o600,
      }
    );
  }

  return outputDir;
}

module.exports = {
  writeHtmlProduct,
};
