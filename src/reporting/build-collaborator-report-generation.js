const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const INPUT_SCHEMA =
  "src/reporting/collaborator-report-input.schema.json";

const OUTPUT_SCHEMA =
  "src/reporting/collaborator-report-generation.schema.json";

function loadJson(filePath, label) {
  const absolutePath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${label} NOT FOUND: ${filePath}`);
  }

  try {
    return JSON.parse(
      fs.readFileSync(absolutePath, "utf8"),
    );
  } catch (error) {
    throw new Error(
      `${label} INVALID JSON: ${filePath}\n${error.message}`,
    );
  }
}

function compileSchema(schemaPath) {
  const schema = loadJson(schemaPath, "SCHEMA");

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  addFormats(ajv);

  return ajv.compile(schema);
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function semanticGuard(input) {
  const eventIds = new Set();

  for (const event of input.events) {
    if (eventIds.has(event.eventId)) {
      throw new Error(
        `DUPLICATE EVENT ID: ${event.eventId}`,
      );
    }

    eventIds.add(event.eventId);

    const candidateOpportunityIds =
      [
        ...new Set(
          event.candidateOpportunityIds || [],
        ),
      ].sort();

    const candidateOpportunityId =
      event.candidateOpportunityId || null;

    /*
     * Backward-compatible candidate representation:
     *
     * - singular candidateOpportunityId remains supported;
     * - candidateOpportunityIds carries the complete candidate set;
     * - an ambiguous multi-candidate match must keep the singular
     *   field null;
     * - singular + array may coexist only when they describe the
     *   same single candidate.
     */
    if (
      candidateOpportunityId &&
      candidateOpportunityIds.length > 0 &&
      !candidateOpportunityIds.includes(
        candidateOpportunityId,
      )
    ) {
      throw new Error(
        `CANDIDATE OPPORTUNITY REPRESENTATION CONFLICT: ${event.eventId}`,
      );
    }

    if (
      candidateOpportunityIds.length > 1 &&
      candidateOpportunityId
    ) {
      throw new Error(
        `AMBIGUOUS MULTI-CANDIDATE MUST HAVE null candidateOpportunityId: ${event.eventId}`,
      );
    }

    const effectiveCandidateIds =
      candidateOpportunityIds.length > 0
        ? candidateOpportunityIds
        : candidateOpportunityId
          ? [candidateOpportunityId]
          : [];

    if (
      event.reconciliationOutcome === "LINK_EXISTING"
    ) {
      if (!event.opportunityId) {
        throw new Error(
          `LINK_EXISTING REQUIRES opportunityId: ${event.eventId}`,
        );
      }

      if (
        effectiveCandidateIds.length > 0
      ) {
        throw new Error(
          `LINK_EXISTING CANNOT CARRY CANDIDATE OPPORTUNITIES: ${event.eventId}`,
        );
      }
    }

    if (
      event.reconciliationOutcome === "POSSIBLE_MATCH"
    ) {
      if (event.opportunityId) {
        throw new Error(
          `POSSIBLE_MATCH CANNOT CONFIRM opportunityId: ${event.eventId}`,
        );
      }

      if (
        effectiveCandidateIds.length < 1
      ) {
        throw new Error(
          `POSSIBLE_MATCH REQUIRES candidate opportunity evidence: ${event.eventId}`,
        );
      }
    }

    if (
      event.reconciliationOutcome === "NEW_CANDIDATE"
    ) {
      if (event.opportunityId) {
        throw new Error(
          `NEW_CANDIDATE CANNOT HAVE opportunityId: ${event.eventId}`,
        );
      }

      if (
        effectiveCandidateIds.length > 0
      ) {
        throw new Error(
          `NEW_CANDIDATE CANNOT HAVE CANDIDATE OPPORTUNITY REFERENCES: ${event.eventId}`,
        );
      }
    }

    if (
      (
        event.reconciliationOutcome === "EXACT_DUPLICATE" ||
        event.reconciliationOutcome === "DISCARD"
      ) &&
      (
        event.opportunityId ||
        effectiveCandidateIds.length > 0
      )
    ) {
      throw new Error(
        `${event.reconciliationOutcome} CANNOT CARRY OPPORTUNITY REFERENCES: ${event.eventId}`,
      );
    }
  }
}

function buildRow(reportId, event, reportStatus) {
  const fingerprint = [
    "WALLTECH_COLLABORATOR_REPORT_ROW_V1",
    reportId,
    event.eventId,
    event.collaboratorId,
    event.collaboratorName,
    event.occurredAt,
    event.channel,
    event.eventType,
    event.direction,
    event.sourceProvenance,
    event.evidenceRef,
    event.reconciliationOutcome,
    event.opportunityId || "NONE",
    event.candidateOpportunityId || "NONE",
    JSON.stringify(
      [
        ...new Set(
          event.candidateOpportunityIds || [],
        ),
      ].sort(),
    ),
    reportStatus,
  ].join("\n");

  return {
    rowId: `CRR-${sha256(fingerprint)}`,
    eventId: event.eventId,
    collaboratorId: event.collaboratorId,
    collaboratorName: event.collaboratorName,
    occurredAt: event.occurredAt,
    channel: event.channel,
    eventType: event.eventType,
    direction: event.direction,
    sourceProvenance: event.sourceProvenance,
    evidenceRef: event.evidenceRef,
    reconciliationOutcome:
      event.reconciliationOutcome,
    opportunityId:
      event.opportunityId || null,
    candidateOpportunityId:
      event.candidateOpportunityId || null,
    candidateOpportunityIds:
      [
        ...new Set(
          event.candidateOpportunityIds || (
            event.candidateOpportunityId
              ? [event.candidateOpportunityId]
              : []
          ),
        ),
      ].sort(),
    reportStatus,
  };
}

function decisionForEvent(reportId, event) {
  switch (event.reconciliationOutcome) {
    case "LINK_EXISTING": {
      const row = buildRow(
        reportId,
        event,
        "CONFIRMED",
      );

      return {
        eventId: event.eventId,
        decision: "INCLUDE",
        reasonCode: "LINK_EXISTING_CONFIRMED",
        reportStatus: "CONFIRMED",
        row,
      };
    }

    case "POSSIBLE_MATCH": {
      const row = buildRow(
        reportId,
        event,
        "MISSING_PROOF",
      );

      return {
        eventId: event.eventId,
        decision: "INCLUDE",
        reasonCode:
          "POSSIBLE_MATCH_REQUIRES_PROOF",
        reportStatus: "MISSING_PROOF",
        row,
      };
    }

    case "NEW_CANDIDATE": {
      const row = buildRow(
        reportId,
        event,
        "UNLINKED",
      );

      return {
        eventId: event.eventId,
        decision: "INCLUDE",
        reasonCode:
          "NEW_CANDIDATE_UNLINKED",
        reportStatus: "UNLINKED",
        row,
      };
    }

    case "EXACT_DUPLICATE":
      return {
        eventId: event.eventId,
        decision: "EXCLUDE",
        reasonCode:
          "EXACT_DUPLICATE_AUDIT_ONLY",
        reportStatus: "AUDIT_ONLY",
        row: null,
      };

    case "DISCARD":
      return {
        eventId: event.eventId,
        decision: "EXCLUDE",
        reasonCode: "DISCARD_EXCLUDED",
        reportStatus: "DISCARDED",
        row: null,
      };

    default:
      throw new Error(
        `UNSUPPORTED RECONCILIATION OUTCOME: ${event.reconciliationOutcome}`,
      );
  }
}

function buildGeneration(input) {
  const validateInput =
    compileSchema(INPUT_SCHEMA);

  if (!validateInput(input)) {
    throw new Error(
      `COLLABORATOR REPORT INPUT: INVALID\n${JSON.stringify(
        validateInput.errors,
        null,
        2,
      )}`,
    );
  }

  semanticGuard(input);

  const events = [...input.events].sort(
    (a, b) => {
      const timeDifference =
        new Date(a.occurredAt).getTime() -
        new Date(b.occurredAt).getTime();

      if (timeDifference !== 0) {
        return timeDifference;
      }

      return a.eventId.localeCompare(
        b.eventId,
      );
    },
  );

  const decisions = events.map(
    (event) =>
      decisionForEvent(
        input.reportId,
        event,
      ),
  );

  const rows = decisions
    .filter(
      (decision) =>
        decision.decision === "INCLUDE",
    )
    .map((decision) => decision.row);

  const generationFingerprint = [
    "WALLTECH_COLLABORATOR_REPORT_GENERATION_V1",
    input.reportId,
    ...decisions.map((decision) =>
      [
        decision.eventId,
        decision.decision,
        decision.reasonCode,
        decision.reportStatus,
        decision.row?.rowId || "NO_ROW",
      ].join(":"),
    ),
    "CRM_WRITE_FALSE",
    "OPPORTUNITY_CREATION_FALSE",
    "STAGE_MUTATION_FALSE",
    "OWNER_MUTATION_FALSE",
    "COMMERCIAL_STATE_MUTATION_FALSE",
  ].join("\n");

  const result = {
    generationVersion: "1.0",
    generationType:
      "COLLABORATOR_REPORT_GENERATION",
    generationId:
      `CGR-${sha256(generationFingerprint)}`,
    reportId: input.reportId,
    decisionPolicy:
      "RECONCILIATION_BOUND_NON_MUTATING_V1",
    generatedAt:
      new Date().toISOString(),
    rows,
    decisions,
    counts: {
      inputEvents:
        events.length,
      includedRows:
        rows.length,
      excludedEvents:
        decisions.filter(
          (decision) =>
            decision.decision === "EXCLUDE",
        ).length,
      confirmedRows:
        rows.filter(
          (row) =>
            row.reportStatus === "CONFIRMED",
        ).length,
      missingProofRows:
        rows.filter(
          (row) =>
            row.reportStatus === "MISSING_PROOF",
        ).length,
      unlinkedRows:
        rows.filter(
          (row) =>
            row.reportStatus === "UNLINKED",
        ).length,
    },
    mutationPolicy: {
      crmWrite: false,
      opportunityCreation: false,
      stageMutation: false,
      ownerMutation: false,
      commercialStateMutation: false,
    },
  };

  const validateOutput =
    compileSchema(OUTPUT_SCHEMA);

  if (!validateOutput(result)) {
    throw new Error(
      `COLLABORATOR REPORT GENERATION: INVALID\n${JSON.stringify(
        validateOutput.errors,
        null,
        2,
      )}`,
    );
  }

  return result;
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/build-collaborator-report-generation.js <input.json> [output.json]",
    );
    process.exit(2);
  }

  try {
    const input = loadJson(
      inputPath,
      "COLLABORATOR REPORT INPUT",
    );

    const result =
      buildGeneration(input);

    if (outputPath) {
      fs.writeFileSync(
        path.resolve(
          process.cwd(),
          outputPath,
        ),
        `${JSON.stringify(
          result,
          null,
          2,
        )}\n`,
      );

      console.log(
        "COLLABORATOR REPORT GENERATION: PASS",
      );
      console.log(
        `REPORT: ${result.reportId}`,
      );
      console.log(
        `GENERATION ID: ${result.generationId}`,
      );
      console.log(
        `INPUT EVENTS: ${result.counts.inputEvents}`,
      );
      console.log(
        `INCLUDED ROWS: ${result.counts.includedRows}`,
      );
      console.log(
        `EXCLUDED EVENTS: ${result.counts.excludedEvents}`,
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
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildGeneration,
  decisionForEvent,
};
