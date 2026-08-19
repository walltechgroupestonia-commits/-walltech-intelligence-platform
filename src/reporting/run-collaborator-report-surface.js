const fs = require("node:fs");
const path = require("node:path");

const {
  runOperationalCollaboratorReport,
} = require(
  "./run-collaborator-report-operational.js"
);

const {
  DEFAULT_OUTPUT_DIR,
  writeCollaboratorReportSurface,
} = require(
  "./write-collaborator-report-surface.js"
);

function loadJson(
  filePath,
  label,
) {
  const absolutePath =
    path.resolve(
      process.cwd(),
      filePath,
    );

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    throw new Error(
      `${label} NOT FOUND: ${filePath}`,
    );
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        absolutePath,
        "utf8",
      ),
    );
  } catch (error) {
    throw new Error(
      `${label} INVALID JSON: ${filePath}\n${error.message}`,
    );
  }
}

function runCollaboratorReportSurface(
  operationalInput,
  options = {},
) {
  const runOperationalFn =
    options.runOperationalFn ??
    runOperationalCollaboratorReport;

  const writeSurfaceFn =
    options.writeSurfaceFn ??
    writeCollaboratorReportSurface;

  const outputDir =
    options.outputDir ??
    DEFAULT_OUTPUT_DIR;

  /*
   * One operational transaction:
   *
   * explicit operational input
   * → real evidence acquisition
   * → reconciliation/report generation
   * → persistent human-readable surface
   *
   * No business inference is introduced here.
   * No CRM/commercial mutation is introduced here.
   */
  const report =
    runOperationalFn(
      operationalInput,
    );

  const surface =
    writeSurfaceFn(
      report,
      outputDir,
    );

  return {
    report,
    surface,
  };
}

function main() {
  const inputPath =
    process.argv[2];

  const outputDir =
    process.argv[3] ??
    DEFAULT_OUTPUT_DIR;

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/run-collaborator-report-surface.js <operational-run-input.json> [output-dir]",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const input =
      loadJson(
        inputPath,
        "COLLABORATOR REPORT SURFACE INPUT",
      );

    const {
      report,
      surface,
    } =
      runCollaboratorReportSurface(
        input,
        {
          outputDir,
        },
      );

    console.log(
      "COLLABORATOR REPORT OPERATIONAL SURFACE: PASS",
    );

    console.log(
      `REPORT: ${report.reportId}`,
    );

    console.log(
      `INPUT EVENTS: ${report.reconciliation.counts.inputEvents}`,
    );

    console.log(
      `INCLUDED ROWS: ${report.reportGeneration.counts.includedRows}`,
    );

    console.log(
      `JSON: ${surface.jsonPath}`,
    );

    console.log(
      `MARKDOWN: ${surface.markdownPath}`,
    );

    console.log(
      `LATEST: ${surface.latestPath}`,
    );

    console.log(
      "BUSINESS INFERENCE: NONE",
    );

    console.log(
      "CRM / COMMERCIAL MUTATION: NONE",
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
  loadJson,
  runCollaboratorReportSurface,
};
