const fs = require("node:fs");
const path = require("node:path");

const {
  buildReconciliationInputFromEvidence,
} = require(
  "./build-collaborator-reconciliation-input-from-evidence.js"
);

const {
  buildOrchestration,
} = require(
  "./build-collaborator-report-orchestration.js"
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

function assertZeroMutation(
  label,
  mutationPolicy,
) {
  if (
    !mutationPolicy ||
    Object.values(
      mutationPolicy,
    ).some(
      value =>
        value !== false,
    )
  ) {
    throw new Error(
      `${label} MUTATION POLICY VIOLATION`,
    );
  }
}

function buildCollaboratorReportFromEvidence(
  adapterInput,
) {
  /*
   * AZIONE 16:
   * MailEvidence + communication detection +
   * USER_CONFIRMED_DIRECTORY
   * →
   * canonical reconciliation input.
   */
  const reconciliationInput =
    buildReconciliationInputFromEvidence(
      adapterInput,
    );

  /*
   * AZIONE 15:
   * reconciliation
   * →
   * bridge
   * →
   * report generation
   * →
   * final orchestration result.
   *
   * No decision logic is duplicated here.
   */
  const orchestration =
    buildOrchestration(
      reconciliationInput,
    );

  if (
    reconciliationInput.reportId !==
      adapterInput.reportId ||
    orchestration.reportId !==
      adapterInput.reportId
  ) {
    throw new Error(
      "EVIDENCE REPORT ENTRY POINT REPORT IDENTITY MISMATCH",
    );
  }

  assertZeroMutation(
    "ORCHESTRATION",
    orchestration.mutationPolicy,
  );

  assertZeroMutation(
    "RECONCILIATION",
    orchestration
      .reconciliation
      .mutationPolicy,
  );

  assertZeroMutation(
    "REPORT GENERATION",
    orchestration
      .reportGeneration
      .mutationPolicy,
  );

  /*
   * Return the existing authoritative AZIONE 15 product
   * directly. No wrapper contract is introduced.
   */
  return orchestration;
}

function main() {
  const inputPath =
    process.argv[2];

  const outputPath =
    process.argv[3] ??
    null;

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/build-collaborator-report-from-evidence.js <adapter-input.json> [output.json]",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const adapterInput =
      loadJson(
        inputPath,
        "COLLABORATOR EVIDENCE REPORT INPUT",
      );

    const result =
      buildCollaboratorReportFromEvidence(
        adapterInput,
      );

    const json =
      `${JSON.stringify(
        result,
        null,
        2,
      )}\n`;

    if (outputPath) {
      const absoluteOutputPath =
        path.resolve(
          process.cwd(),
          outputPath,
        );

      fs.mkdirSync(
        path.dirname(
          absoluteOutputPath,
        ),
        {
          recursive: true,
        },
      );

      fs.writeFileSync(
        absoluteOutputPath,
        json,
      );

      console.log(
        "COLLABORATOR REPORT FROM EVIDENCE: PASS",
      );

      console.log(
        `REPORT: ${result.reportId}`,
      );

      console.log(
        `ORCHESTRATION ID: ${result.orchestrationId}`,
      );

      console.log(
        `RECONCILIATION ID: ${result.reconciliation.reconciliationId}`,
      );

      console.log(
        `GENERATION ID: ${result.reportGeneration.generationId}`,
      );

      console.log(
        `INPUT EVENTS: ${result.reconciliation.counts.inputEvents}`,
      );

      console.log(
        `INCLUDED ROWS: ${result.reportGeneration.counts.includedRows}`,
      );

      console.log(
        `EXCLUDED EVENTS: ${result.reportGeneration.counts.excludedEvents}`,
      );

      console.log(
        "CRM / COMMERCIAL MUTATION: NONE",
      );

      return;
    }

    process.stdout.write(
      json,
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
  buildCollaboratorReportFromEvidence,
};
