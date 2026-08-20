const fs = require("node:fs");
const path = require("node:path");

const AjvModule =
  require("ajv/dist/2020");
const Ajv =
  AjvModule.default || AjvModule;

const addFormatsModule =
  require("ajv-formats");
const addFormats =
  addFormatsModule.default ||
  addFormatsModule;

const CYCLE_SCHEMA_PATH =
  "src/mail/communication-cycle.schema.json";

function loadJson(filePath) {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        process.cwd(),
        filePath,
      ),
      "utf8",
    ),
  );
}

function cycleValidator() {
  const schema =
    loadJson(
      CYCLE_SCHEMA_PATH,
    );

  const ajv =
    new Ajv({
      allErrors: true,
      strict: true,
    });

  addFormats(ajv);

  return ajv.compile(schema);
}

function invariant(
  condition,
  message,
) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseTime(
  value,
  label,
) {
  if (!value) {
    return null;
  }

  const time =
    new Date(value).getTime();

  invariant(
    Number.isFinite(time),
    `${label} INVALID DATE-TIME: ${value}`,
  );

  return time;
}

function localDateParts(
  value,
  timeZone,
) {
  const formatter =
    new Intl.DateTimeFormat(
      "it-IT",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      },
    );

  const parts =
    Object.fromEntries(
      formatter
        .formatToParts(
          new Date(value),
        )
        .filter(
          x =>
            x.type !== "literal",
        )
        .map(
          x => [
            x.type,
            x.value,
          ],
        ),
    );

  return {
    year:
      Number(parts.year),

    month:
      Number(parts.month),

    day:
      Number(parts.day),

    hour:
      parts.hour,

    minute:
      parts.minute,
  };
}

function calendarOrdinal(
  parts,
) {
  return Math.floor(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
    ) /
    86400000,
  );
}

function freshnessLabel(
  lastEvidenceAt,
  asOf,
  timeZone,
) {
  if (!lastEvidenceAt) {
    return "Mai aggiornato";
  }

  const evidence =
    localDateParts(
      lastEvidenceAt,
      timeZone,
    );

  const now =
    localDateParts(
      asOf,
      timeZone,
    );

  const difference =
    calendarOrdinal(now) -
    calendarOrdinal(evidence);

  const time =
    `${evidence.hour}.${evidence.minute}`;

  if (difference === 0) {
    return `Aggiornato oggi alle ${time}`;
  }

  if (difference === 1) {
    return `Aggiornato ieri alle ${time}`;
  }

  return [
    "Aggiornato ",
    String(evidence.day)
      .padStart(2, "0"),
    "/",
    String(evidence.month)
      .padStart(2, "0"),
    "/",
    evidence.year,
    " alle ",
    time,
  ].join("");
}

function deriveAttention(
  cycle,
  asOf,
) {
  if (
    cycle.lifecyclePhase ===
    "STOP"
  ) {
    return {
      overdue:
        false,

      overdueHours:
        0,

      effectiveControlStatus:
        "NOT_APPLICABLE",
    };
  }

  const now =
    parseTime(
      asOf,
      "AS OF",
    );

  const due =
    parseTime(
      cycle.nextActionDueAt,
      "NEXT ACTION DUE",
    );

  const overdue =
    due !== null &&
    now > due;

  const overdueHours =
    overdue
      ? Math.floor(
          (now - due) /
          3600000,
        )
      : 0;

  return {
    overdue,

    overdueHours,

    /*
     * Report-level management escalation.
     *
     * This DOES NOT mutate the authoritative
     * CommunicationCycle. It only surfaces
     * an overdue open cycle as OUT_OF_CONTROL.
     */
    effectiveControlStatus:
      overdue
        ? "OUT_OF_CONTROL"
        : cycle.controlStatus,
  };
}

const CONTROL_RANK = {
  OUT_OF_CONTROL: 0,
  ACTION_REQUIRED: 1,
  BLOCKED: 2,
  WAITING_EXTERNAL: 3,
  IN_CONTROL: 4,
  NOT_APPLICABLE: 5,
};

function buildCycleRow(
  cycle,
  asOf,
  timeZone,
) {
  const attention =
    deriveAttention(
      cycle,
      asOf,
    );

  const lastEvidence =
    parseTime(
      cycle.lastEvidenceAt,
      "LAST EVIDENCE",
    );

  const now =
    parseTime(
      asOf,
      "AS OF",
    );

  const evidenceAgeHours =
    lastEvidence === null
      ? null
      : Math.max(
          0,
          Math.floor(
            (now - lastEvidence) /
            3600000,
          ),
        );

  const missing =
    Array.isArray(
      cycle.missingCommercialData,
    )
      ? cycle
          .missingCommercialData
          .filter(Boolean)
      : [];

  return {
    cycleId:
      cycle.dealId,

    cycleName:
      cycle.dealName,

    lifecyclePhase:
      cycle.lifecyclePhase,

    controlStatus:
      cycle.controlStatus,

    effectiveControlStatus:
      attention
        .effectiveControlStatus,

    commercialStatus:
      cycle.status,

    priority:
      cycle.priority,

    stopOutcome:
      cycle.stopOutcome ??
      null,

    latestDone:
      cycle.latestDone ??
      null,

    latestUpdate:
      cycle.latestUpdate ??
      cycle.status,

    blocker:
      cycle.currentBlocker ||
      null,

    missing,

    nextAction:
      cycle.nextAction,

    nextActionDueAt:
      cycle.nextActionDueAt ??
      null,

    overdue:
      attention.overdue,

    overdueHours:
      attention.overdueHours,

    lastEvidenceAt:
      cycle.lastEvidenceAt,

    lastActionAt:
      cycle.lastActionAt,

    updatedAt:
      cycle.updatedAt,

    evidenceAgeHours,

    freshness:
      freshnessLabel(
        cycle.lastEvidenceAt,
        asOf,
        timeZone,
      ),

    assignedCollaboratorIds:
      [
        ...cycle
          .assignedCollaboratorIds,
      ],

    reportRecipientCollaboratorIds:
      [
        ...cycle
          .reportRecipientCollaboratorIds,
      ],

    evidenceCount:
      Array.isArray(
        cycle.evidence,
      )
        ? cycle.evidence.length
        : 0,
  };
}

function sortRows(
  rows,
) {
  return [
    ...rows,
  ].sort(
    (a, b) => {
      const control =
        (
          CONTROL_RANK[
            a.effectiveControlStatus
          ] ?? 99
        ) -
        (
          CONTROL_RANK[
            b.effectiveControlStatus
          ] ?? 99
        );

      if (control !== 0) {
        return control;
      }

      if (
        a.overdueHours !==
        b.overdueHours
      ) {
        return (
          b.overdueHours -
          a.overdueHours
        );
      }

      return String(
        a.cycleName,
      ).localeCompare(
        String(
          b.cycleName,
        ),
      );
    },
  );
}

function buildCounts(
  rows,
) {
  const count =
    predicate =>
      rows.filter(
        predicate,
      ).length;

  return {
    total:
      rows.length,

    start:
      count(
        x =>
          x.lifecyclePhase ===
          "START",
      ),

    change:
      count(
        x =>
          x.lifecyclePhase ===
          "CHANGE",
      ),

    stop:
      count(
        x =>
          x.lifecyclePhase ===
          "STOP",
      ),

    outOfControl:
      count(
        x =>
          x.effectiveControlStatus ===
          "OUT_OF_CONTROL",
      ),

    actionRequired:
      count(
        x =>
          x.effectiveControlStatus ===
          "ACTION_REQUIRED",
      ),

    blocked:
      count(
        x =>
          x.effectiveControlStatus ===
          "BLOCKED",
      ),

    waitingExternal:
      count(
        x =>
          x.effectiveControlStatus ===
          "WAITING_EXTERNAL",
      ),

    inControl:
      count(
        x =>
          x.effectiveControlStatus ===
          "IN_CONTROL",
      ),

    monetized:
      count(
        x =>
          x.stopOutcome ===
          "MONETIZED",
      ),

    noGo:
      count(
        x =>
          x.stopOutcome ===
          "NO_GO",
      ),
  };
}

function escapeMd(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "-";
  }

  return String(value)
    .replace(
      /\|/g,
      "\\|",
    )
    .replace(
      /\r?\n/g,
      " ",
    );
}

function renderRows(
  rows,
) {
  const lines = [
    "| Ciclo | Phase | Control | Stato | Ultimo DONE / Update | Missing / Blocker | Next Action | Freshness |",
    "|---|---|---|---|---|---|---|---|",
  ];

  for (const row of rows) {
    const missing =
      [
        ...row.missing,
        row.blocker,
      ]
        .filter(Boolean)
        .join("; ");

    const update =
      row.latestDone
        ? `DONE: ${row.latestDone}`
        : row.latestUpdate;

    const control =
      row.overdue
        ? `${row.effectiveControlStatus} — OVERDUE ${row.overdueHours}h`
        : row.effectiveControlStatus;

    lines.push(
      `| ${escapeMd(row.cycleName)} | ${escapeMd(row.lifecyclePhase)} | ${escapeMd(control)} | ${escapeMd(row.commercialStatus)} | ${escapeMd(update)} | ${escapeMd(missing)} | ${escapeMd(row.nextAction)} | ${escapeMd(row.freshness)} |`,
    );
  }

  return lines;
}

function renderMaxMarkdown(
  report,
) {
  const c =
    report.counts;

  return [
    "# WALLTECH — MAX MASTER PRODUCTION REPORT",
    "",
    `**Report generated:** ${report.generatedAt}`,
    `**As of:** ${report.asOf}`,
    "",
    "## CONTROL SUMMARY",
    "",
    `- Cicli totali: **${c.total}**`,
    `- START: **${c.start}**`,
    `- CHANGE: **${c.change}**`,
    `- STOP: **${c.stop}**`,
    `- OUT OF CONTROL: **${c.outOfControl}**`,
    `- ACTION REQUIRED: **${c.actionRequired}**`,
    `- BLOCKED: **${c.blocked}**`,
    `- WAITING EXTERNAL: **${c.waitingExternal}**`,
    `- MONETIZED: **${c.monetized}**`,
    `- NO GO: **${c.noGo}**`,
    "",
    "## CICLI",
    "",
    ...renderRows(
      report.cycles,
    ),
    "",
    "## DELIVERY CONTROL",
    "",
    "- SEND ENABLED: **NO**",
    "- REPORT TYPE: **INTERNAL MAX MASTER**",
    "",
  ].join("\n");
}

function renderCollaboratorMarkdown(
  report,
) {
  const c =
    report.counts;

  return [
    `# WALLTECH — REPORT ${report.collaborator.displayName}`,
    "",
    "**PREVIEW / MANAGEMENT REPORT**",
    "",
    `**Report generated:** ${report.generatedAt}`,
    `**As of:** ${report.asOf}`,
    "",
    "## SINTESI",
    "",
    `- Cicli: **${c.total}**`,
    `- START: **${c.start}**`,
    `- CHANGE: **${c.change}**`,
    `- STOP: **${c.stop}**`,
    `- OUT OF CONTROL: **${c.outOfControl}**`,
    `- ACTION REQUIRED: **${c.actionRequired}**`,
    "",
    "## CICLI",
    "",
    ...renderRows(
      report.cycles,
    ),
    "",
    "## DELIVERY CONTROL",
    "",
    "- SEND ENABLED: **NO**",
    "- EMAIL DESTINATARIO SELEZIONATA: **NONE**",
    "- MAX EXPLICIT APPROVAL REQUIRED: **YES**",
    "",
  ].join("\n");
}

function safeId(
  value,
) {
  return String(value)
    .replace(
      /[^A-Za-z0-9._-]/g,
      "_",
    );
}

function writeAtomic(
  target,
  content,
) {
  fs.mkdirSync(
    path.dirname(target),
    {
      recursive: true,
    },
  );

  const temp =
    `${target}.tmp-${process.pid}`;

  fs.writeFileSync(
    temp,
    content,
    {
      mode: 0o600,
    },
  );

  fs.renameSync(
    temp,
    target,
  );
}

function buildManagementCycleReports(
  input,
) {
  invariant(
    input &&
    typeof input === "object",
    "INPUT REQUIRED",
  );

  invariant(
    Array.isArray(
      input.cycles,
    ),
    "CYCLES MUST BE AN ARRAY",
  );

  invariant(
    Array.isArray(
      input.collaborators,
    ),
    "COLLABORATORS MUST BE AN ARRAY",
  );

  const asOf =
    input.asOf ||
    new Date().toISOString();

  parseTime(
    asOf,
    "AS OF",
  );

  const timeZone =
    input.timeZone ||
    "Europe/Tallinn";

  const collaborators =
    new Map();

  for (
    const collaborator
    of input.collaborators
  ) {
    invariant(
      collaborator &&
      typeof collaborator.collaboratorId ===
        "string" &&
      collaborator.collaboratorId.trim(),
      "COLLABORATOR ID REQUIRED",
    );

    invariant(
      typeof collaborator.displayName ===
        "string" &&
      collaborator.displayName.trim(),
      `DISPLAY NAME REQUIRED: ${collaborator.collaboratorId}`,
    );

    invariant(
      !collaborators.has(
        collaborator.collaboratorId,
      ),
      `DUPLICATE COLLABORATOR: ${collaborator.collaboratorId}`,
    );

    collaborators.set(
      collaborator.collaboratorId,
      collaborator,
    );
  }

  const validateCycle =
    cycleValidator();

  const rows = [];

  const cycleIds =
    new Set();

  for (
    const cycle
    of input.cycles
  ) {
    if (
      !validateCycle(
        cycle,
      )
    ) {
      throw new Error(
        `COMMUNICATION CYCLE INVALID: ${cycle.dealId || "UNKNOWN"}\n${JSON.stringify(
          validateCycle.errors,
          null,
          2,
        )}`,
      );
    }

    invariant(
      cycle.lifecyclePhase,
      `MANAGEMENT LIFECYCLE MISSING: ${cycle.dealId}`,
    );

    invariant(
      !cycleIds.has(
        cycle.dealId,
      ),
      `DUPLICATE CYCLE ID: ${cycle.dealId}`,
    );

    cycleIds.add(
      cycle.dealId,
    );

    for (
      const recipientId
      of cycle
        .reportRecipientCollaboratorIds
    ) {
      invariant(
        collaborators.has(
          recipientId,
        ),
        `UNKNOWN REPORT RECIPIENT: ${recipientId} | ${cycle.dealId}`,
      );
    }

    rows.push(
      buildCycleRow(
        cycle,
        asOf,
        timeZone,
      ),
    );
  }

  const sorted =
    sortRows(
      rows,
    );

  const generatedAt =
    new Date().toISOString();

  const maxReport = {
    reportVersion:
      "1.0",

    reportType:
      "MAX_MASTER_PRODUCTION_REPORT",

    generatedAt,

    asOf,

    timeZone,

    counts:
      buildCounts(
        sorted,
      ),

    cycles:
      sorted,

    deliveryControl: {
      sendEnabled:
        false,

      recipient:
        "MAX_INTERNAL",

      approvalRequired:
        false,
    },
  };

  const collaboratorReports =
    [];

  for (
    const [
      collaboratorId,
      collaborator,
    ]
    of collaborators.entries()
  ) {
    const collaboratorRows =
      sorted.filter(
        row =>
          row
            .reportRecipientCollaboratorIds
            .includes(
              collaboratorId,
            ),
      );

    if (
      collaboratorRows.length === 0
    ) {
      continue;
    }

    collaboratorReports.push({
      reportVersion:
        "1.0",

      reportType:
        "INDIVIDUAL_COLLABORATOR_REPORT",

      generatedAt,

      asOf,

      timeZone,

      collaborator: {
        collaboratorId,

        displayName:
          collaborator.displayName,
      },

      counts:
        buildCounts(
          collaboratorRows,
        ),

      cycles:
        collaboratorRows,

      deliveryControl: {
        sendEnabled:
          false,

        recipientCollaboratorId:
          collaboratorId,

        selectedEmail:
          null,

        approvalRequired:
          "MAX_EXPLICIT_APPROVAL",
      },
    });
  }

  return {
    managementReportVersion:
      "1.0",

    managementReportType:
      "WALLTECH_CYCLE_MANAGEMENT_REPORT_SET",

    generatedAt,

    asOf,

    timeZone,

    maxReport,

    collaboratorReports,
  };
}

function writeManagementReportSet(
  result,
  outputDir,
) {
  const root =
    path.resolve(
      process.cwd(),
      outputDir,
    );

  fs.mkdirSync(
    root,
    {
      recursive: true,
    },
  );

  writeAtomic(
    path.join(
      root,
      "report-set.json",
    ),
    JSON.stringify(
      result,
      null,
      2,
    ) + "\n",
  );

  writeAtomic(
    path.join(
      root,
      "max-master.md",
    ),
    renderMaxMarkdown(
      result.maxReport,
    ) + "\n",
  );

  const individualDir =
    path.join(
      root,
      "individual",
    );

  for (
    const report
    of result.collaboratorReports
  ) {
    const id =
      safeId(
        report
          .collaborator
          .collaboratorId,
      );

    writeAtomic(
      path.join(
        individualDir,
        `${id}.json`,
      ),
      JSON.stringify(
        report,
        null,
        2,
      ) + "\n",
    );

    writeAtomic(
      path.join(
        individualDir,
        `${id}.md`,
      ),
      renderCollaboratorMarkdown(
        report,
      ) + "\n",
    );
  }

  return root;
}

function main() {
  const inputPath =
    process.argv[2];

  const outputDir =
    process.argv[3] ||
    "runtime/reports/management";

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/build-management-cycle-reports.js <input.json> [output-dir]",
    );

    process.exit(2);
  }

  try {
    const input =
      loadJson(
        inputPath,
      );

    const result =
      buildManagementCycleReports(
        input,
      );

    const output =
      writeManagementReportSet(
        result,
        outputDir,
      );

    console.log(
      "MANAGEMENT REPORT ENGINE: PASS",
    );

    console.log(
      `MAX CYCLES: ${result.maxReport.counts.total}`,
    );

    console.log(
      `INDIVIDUAL REPORTS: ${result.collaboratorReports.length}`,
    );

    console.log(
      `OUT OF CONTROL: ${result.maxReport.counts.outOfControl}`,
    );

    console.log(
      `OUTPUT: ${output}`,
    );

    console.log(
      "REPORT SEND: NONE",
    );
  } catch (error) {
    console.error(
      error.stack ||
      error.message,
    );

    process.exit(1);
  }
}

if (
  require.main === module
) {
  main();
}

module.exports = {
  buildManagementCycleReports,
  writeManagementReportSet,
  freshnessLabel,
  deriveAttention,
};
