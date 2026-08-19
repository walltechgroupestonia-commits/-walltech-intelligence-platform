const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Ajv2020Module =
  require("ajv/dist/2020");

const Ajv2020 =
  Ajv2020Module.default ||
  Ajv2020Module;

const addFormatsModule =
  require("ajv-formats");

const addFormats =
  addFormatsModule.default ||
  addFormatsModule;

const {
  buildReconciliation,
} = require(
  "./build-collaborator-reconciliation.js"
);

const {
  buildReportInputFromReconciliation,
} = require(
  "./build-collaborator-report-input-from-reconciliation.js"
);

const {
  buildGeneration,
} = require(
  "./build-collaborator-report-generation.js"
);

const SCHEMA_PATHS = {
  reconciliation:
    "src/reporting/collaborator-reconciliation-result.schema.json",

  reportInput:
    "src/reporting/collaborator-report-input.schema.json",

  reportGeneration:
    "src/reporting/collaborator-report-generation.schema.json",

  orchestration:
    "src/reporting/collaborator-report-orchestration.schema.json",
};

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

function sha256Text(value) {
  return crypto
    .createHash("sha256")
    .update(
      String(value),
      "utf8",
    )
    .digest("hex");
}

/*
 * Canonical JSON representation for hashing.
 *
 * Object-key order must never affect orchestration identity.
 * Array order remains significant because event/report decision
 * order is itself deterministic and meaningful.
 */
function canonicalize(value) {
  if (
    Array.isArray(value)
  ) {
    return value.map(
      canonicalize,
    );
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.keys(value)
      .sort()
      .reduce(
        (
          result,
          key,
        ) => {
          result[key] =
            canonicalize(
              value[key],
            );

          return result;
        },
        {},
      );
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(
    canonicalize(value),
  );
}

function compileOrchestrationSchema() {
  const reconciliationSchema =
    loadJson(
      SCHEMA_PATHS.reconciliation,
      "RECONCILIATION RESULT SCHEMA",
    );

  const reportInputSchema =
    loadJson(
      SCHEMA_PATHS.reportInput,
      "REPORT INPUT SCHEMA",
    );

  const reportGenerationSchema =
    loadJson(
      SCHEMA_PATHS.reportGeneration,
      "REPORT GENERATION SCHEMA",
    );

  const orchestrationSchema =
    loadJson(
      SCHEMA_PATHS.orchestration,
      "REPORT ORCHESTRATION SCHEMA",
    );

  const ajv =
    new Ajv2020({
      allErrors: true,
      strict: true,
    });

  addFormats(ajv);

  ajv.addSchema(
    reconciliationSchema,
  );

  ajv.addSchema(
    reportInputSchema,
  );

  ajv.addSchema(
    reportGenerationSchema,
  );

  return ajv.compile(
    orchestrationSchema,
  );
}

function assertNoMutation(
  label,
  mutationPolicy,
) {
  if (
    !mutationPolicy ||
    Object.values(
      mutationPolicy,
    ).some(
      (value) =>
        value !== false,
    )
  ) {
    throw new Error(
      `${label} MUTATION POLICY VIOLATION`,
    );
  }
}

function buildOrchestration(
  reconciliationInput,
) {
  /*
   * AZIONE 14:
   * deterministic evidence reconciliation.
   */
  const reconciliation =
    buildReconciliation(
      reconciliationInput,
    );

  /*
   * Tamper-resistant bridge.
   *
   * The bridge independently reconstructs and checks
   * the canonical reconciliation before creating
   * the AZIONE 13 input contract.
   */
  const reportInput =
    buildReportInputFromReconciliation(
      reconciliationInput,
      reconciliation,
    );

  /*
   * AZIONE 13:
   * deterministic collaborator report generation.
   */
  const reportGeneration =
    buildGeneration(
      reportInput,
    );

  if (
    reconciliation.reportId !==
      reportInput.reportId ||
    reportInput.reportId !==
      reportGeneration.reportId
  ) {
    throw new Error(
      "ORCHESTRATION REPORT IDENTITY MISMATCH",
    );
  }

  assertNoMutation(
    "RECONCILIATION",
    reconciliation.mutationPolicy,
  );

  assertNoMutation(
    "REPORT GENERATION",
    reportGeneration.mutationPolicy,
  );

  const reportInputHash =
    sha256Text(
      stableStringify(
        reportInput,
      ),
    );

  /*
   * generatedAt fields are observational metadata.
   *
   * They are deliberately excluded from orchestration identity.
   * The orchestrationId binds:
   * - report identity
   * - canonical reconciliation identity
   * - exact bridge/report input
   * - report generation identity
   * - zero-mutation policy
   */
  const orchestrationFingerprint = [
    "WALLTECH_COLLABORATOR_REPORT_ORCHESTRATION_V1",
    reconciliationInput.reportId,
    reconciliation.reconciliationId,
    reportInputHash,
    reportGeneration.generationId,
    "CRM_WRITE_FALSE",
    "OPPORTUNITY_CREATION_FALSE",
    "STAGE_MUTATION_FALSE",
    "OWNER_MUTATION_FALSE",
    "COMMERCIAL_STATE_MUTATION_FALSE",
  ].join("\n");

  const result = {
    orchestrationVersion:
      "1.0",

    orchestrationType:
      "COLLABORATOR_REPORT_ORCHESTRATION_RESULT",

    orchestrationId:
      `CRO-${sha256Text(
        orchestrationFingerprint,
      )}`,

    reportId:
      reconciliationInput.reportId,

    orchestrationPolicy:
      "RECONCILIATION_BRIDGE_GENERATION_V1",

    generatedAt:
      new Date().toISOString(),

    reconciliation,

    reportInput,

    reportGeneration,

    mutationPolicy: {
      crmWrite: false,
      opportunityCreation: false,
      stageMutation: false,
      ownerMutation: false,
      commercialStateMutation: false,
    },
  };

  const validate =
    compileOrchestrationSchema();

  if (
    !validate(result)
  ) {
    throw new Error(
      `COLLABORATOR REPORT ORCHESTRATION RESULT: INVALID\n${JSON.stringify(
        validate.errors,
        null,
        2,
      )}`,
    );
  }

  return result;
}

function main() {
  const inputPath =
    process.argv[2];

  const outputPath =
    process.argv[3];

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/build-collaborator-report-orchestration.js <reconciliation-input.json> [output.json]",
    );

    process.exit(2);
  }

  try {
    const input =
      loadJson(
        inputPath,
        "COLLABORATOR REPORT ORCHESTRATION INPUT",
      );

    const result =
      buildOrchestration(
        input,
      );

    if (
      outputPath
    ) {
      const absoluteOutputPath =
        path.resolve(
          process.cwd(),
          outputPath,
        );

      fs.writeFileSync(
        absoluteOutputPath,
        `${JSON.stringify(
          result,
          null,
          2,
        )}\n`,
      );

      console.log(
        "COLLABORATOR REPORT ORCHESTRATION: PASS",
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

    console.log(
      JSON.stringify(
        result,
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
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
  buildOrchestration,
};
