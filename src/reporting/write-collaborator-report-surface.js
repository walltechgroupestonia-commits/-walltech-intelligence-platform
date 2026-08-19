const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_OUTPUT_DIR =
  "runtime/reports/collaborators";

function requireNonBlank(
  value,
  label,
) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(
      `${label} MUST BE NON-BLANK`,
    );
  }

  return value.trim();
}

function safeReportId(
  reportId,
) {
  const value =
    requireNonBlank(
      reportId,
      "REPORT ID",
    );

  if (
    !/^[A-Za-z0-9._-]+$/.test(
      value,
    )
  ) {
    throw new Error(
      `UNSAFE REPORT ID: ${value}`,
    );
  }

  return value;
}

function escapeMarkdown(
  value,
) {
  if (
    value === undefined ||
    value === null ||
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

function renderCandidateIds(
  row,
) {
  if (
    !Array.isArray(
      row.candidateOpportunityIds,
    ) ||
    row.candidateOpportunityIds.length === 0
  ) {
    return "-";
  }

  return row
    .candidateOpportunityIds
    .join(", ");
}

function renderCollaboratorReportMarkdown(
  report,
) {
  if (
    !report ||
    typeof report !== "object"
  ) {
    throw new Error(
      "REPORT MUST BE AN OBJECT",
    );
  }

  const reportId =
    safeReportId(
      report.reportId,
    );

  const generation =
    report.reportGeneration;

  if (
    !generation ||
    !Array.isArray(
      generation.rows,
    ) ||
    !generation.counts
  ) {
    throw new Error(
      "REPORT GENERATION DATA MISSING",
    );
  }

  const counts =
    generation.counts;

  const lines = [
    "# Walltech — Report Collaboratori",
    "",
    `**Report ID:** ${escapeMarkdown(reportId)}`,
    `**Orchestration ID:** ${escapeMarkdown(report.orchestrationId)}`,
    "",
    "## Sintesi",
    "",
    `- Eventi analizzati: **${counts.inputEvents ?? 0}**`,
    `- Righe incluse: **${counts.includedRows ?? 0}**`,
    `- Confermate: **${counts.confirmedRows ?? 0}**`,
    `- Missing proof: **${counts.missingProofRows ?? 0}**`,
    `- Unlinked: **${counts.unlinkedRows ?? 0}**`,
    `- Escluse: **${counts.excludedEvents ?? 0}**`,
    "",
    "## Attività",
    "",
    "| Collaboratore | Data/Ora | Direzione | Outcome | Stato | Opportunity | Candidate | Evidence |",
    "|---|---|---|---|---|---|---|---|",
  ];

  for (
    const row
    of generation.rows
  ) {
    lines.push(
      [
        escapeMarkdown(
          row.collaboratorName ||
          row.collaboratorId,
        ),

        escapeMarkdown(
          row.occurredAt,
        ),

        escapeMarkdown(
          row.direction,
        ),

        escapeMarkdown(
          row.reconciliationOutcome,
        ),

        escapeMarkdown(
          row.reportStatus,
        ),

        escapeMarkdown(
          row.opportunityId,
        ),

        escapeMarkdown(
          renderCandidateIds(
            row,
          ),
        ),

        escapeMarkdown(
          row.evidenceRef,
        ),
      ].join(" | ")
      .replace(
        /^/,
        "| ",
      )
      .replace(
        /$/,
        " |",
      ),
    );
  }

  lines.push(
    "",
    "## Regole operative",
    "",
    "- Il report espone solo evidence e risultati prodotti dalla pipeline.",
    "- `POSSIBLE_MATCH` non equivale a collegamento confermato.",
    "- `MISSING_PROOF` indica che manca prova autoritativa per il link.",
    "- Nessun collegamento commerciale viene creato automaticamente.",
    "- Nessuna mutazione CRM/commerciale viene eseguita dal report.",
    "",
  );

  return lines.join("\n");
}

function writeAtomically(
  targetPath,
  content,
) {
  const tempPath =
    `${targetPath}.tmp-${process.pid}`;

  fs.writeFileSync(
    tempPath,
    content,
    "utf8",
  );

  fs.renameSync(
    tempPath,
    targetPath,
  );
}

function writeCollaboratorReportSurface(
  report,
  outputDir = DEFAULT_OUTPUT_DIR,
) {
  const reportId =
    safeReportId(
      report.reportId,
    );

  const absoluteDir =
    path.resolve(
      process.cwd(),
      outputDir,
    );

  fs.mkdirSync(
    absoluteDir,
    {
      recursive: true,
    },
  );

  const jsonPath =
    path.join(
      absoluteDir,
      `${reportId}.json`,
    );

  const markdownPath =
    path.join(
      absoluteDir,
      `${reportId}.md`,
    );

  const latestPath =
    path.join(
      absoluteDir,
      "latest.md",
    );

  const json =
    `${JSON.stringify(
      report,
      null,
      2,
    )}\n`;

  const markdown =
    `${renderCollaboratorReportMarkdown(
      report,
    )}\n`;

  writeAtomically(
    jsonPath,
    json,
  );

  writeAtomically(
    markdownPath,
    markdown,
  );

  writeAtomically(
    latestPath,
    markdown,
  );

  return {
    reportId,
    outputDir:
      absoluteDir,
    jsonPath,
    markdownPath,
    latestPath,
  };
}

function main() {
  const inputPath =
    process.argv[2];

  const outputDir =
    process.argv[3] ||
    DEFAULT_OUTPUT_DIR;

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/write-collaborator-report-surface.js <report.json> [output-dir]",
    );

    process.exit(2);
  }

  try {
    const report =
      JSON.parse(
        fs.readFileSync(
          path.resolve(
            process.cwd(),
            inputPath,
          ),
          "utf8",
        ),
      );

    const result =
      writeCollaboratorReportSurface(
        report,
        outputDir,
      );

    console.log(
      "COLLABORATOR REPORT SURFACE WRITE: PASS",
    );

    console.log(
      `REPORT: ${result.reportId}`,
    );

    console.log(
      `JSON: ${result.jsonPath}`,
    );

    console.log(
      `MARKDOWN: ${result.markdownPath}`,
    );

    console.log(
      `LATEST: ${result.latestPath}`,
    );
  } catch (error) {
    console.error(
      error.message,
    );

    process.exitCode = 1;
  }
}

if (
  require.main === module
) {
  main();
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  safeReportId,
  renderCollaboratorReportMarkdown,
  writeCollaboratorReportSurface,
};
