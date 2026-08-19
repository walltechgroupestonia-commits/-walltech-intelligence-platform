const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 =
  Ajv2020Module.default || Ajv2020Module;

const addFormatsModule =
  require("ajv-formats");
const addFormats =
  addFormatsModule.default ||
  addFormatsModule;

const {
  validateReconciliationInput,
} = require(
  "./validate-collaborator-reconciliation-input.js"
);

const RESULT_SCHEMA_PATH =
  "src/reporting/collaborator-reconciliation-result.schema.json";

function loadJson(filePath, label) {
  const absolutePath =
    path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
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
    .update(String(value), "utf8")
    .digest("hex");
}

function uniqueSorted(values) {
  return [
    ...new Set(values),
  ].sort((a, b) =>
    a.localeCompare(b)
  );
}

function compileResultSchema() {
  const schema =
    loadJson(
      RESULT_SCHEMA_PATH,
      "RECONCILIATION RESULT SCHEMA",
    );

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  addFormats(ajv);

  return ajv.compile(schema);
}

function buildIndexes(input) {
  const knownByEvidenceRef =
    new Map();

  const knownBySourceSha256 =
    new Map();

  for (
    const known
    of input.knownEvidence
  ) {
    knownByEvidenceRef.set(
      known.evidenceRef,
      known,
    );

    if (known.sourceSha256) {
      const existing =
        knownBySourceSha256.get(
          known.sourceSha256,
        );

      /*
       * Multiple historical evidence references may legitimately
       * point to the same underlying source bytes.
       *
       * Always select the lexicographically-smallest evidenceRef
       * as canonical so duplicate resolution is independent of
       * input-array order.
       */
      if (
        !existing ||
        known.evidenceRef.localeCompare(
          existing.evidenceRef,
        ) < 0
      ) {
        knownBySourceSha256.set(
          known.sourceSha256,
          known,
        );
      }
    }
  }

  const bindingByEvidenceRef =
    new Map();

  for (
    const binding
    of input.authoritativeBindings
  ) {
    bindingByEvidenceRef.set(
      binding.evidenceRef,
      binding,
    );
  }

  const candidatesByEventId =
    new Map();

  for (
    const candidate
    of input.candidateMatches
  ) {
    if (
      !candidatesByEventId.has(
        candidate.eventId,
      )
    ) {
      candidatesByEventId.set(
        candidate.eventId,
        [],
      );
    }

    candidatesByEventId
      .get(candidate.eventId)
      .push(candidate);
  }

  return {
    knownByEvidenceRef,
    knownBySourceSha256,
    bindingByEvidenceRef,
    candidatesByEventId,
  };
}

function decisionFingerprint({
  reportId,
  event,
  reconciliationOutcome,
  reasonCode,
  opportunityId,
  candidateOpportunityIds,
  duplicateEvidenceRef,
  duplicateBasis,
}) {
  return [
    "WALLTECH_COLLABORATOR_EVENT_RECONCILIATION_DECISION_V1",
    reportId,
    event.eventId,
    event.evidenceRef,
    reconciliationOutcome,
    reasonCode,
    opportunityId || "NONE",
    candidateOpportunityIds.join(","),
    duplicateEvidenceRef || "NONE",
    duplicateBasis,
  ].join("\n");
}

function buildDecision({
  reportId,
  event,
  reconciliationOutcome,
  reasonCode,
  opportunityId = null,
  candidateOpportunityIds = [],
  duplicateEvidenceRef = null,
  duplicateBasis = "NONE",
}) {
  const normalizedCandidates =
    uniqueSorted(
      candidateOpportunityIds,
    );

  const fingerprint =
    decisionFingerprint({
      reportId,
      event,
      reconciliationOutcome,
      reasonCode,
      opportunityId,
      candidateOpportunityIds:
        normalizedCandidates,
      duplicateEvidenceRef,
      duplicateBasis,
    });

  return {
    decisionId:
      `CED-${sha256Text(fingerprint)}`,
    eventId:
      event.eventId,
    evidenceRef:
      event.evidenceRef,
    reconciliationOutcome,
    reasonCode,
    opportunityId,
    candidateOpportunityIds:
      normalizedCandidates,
    duplicateEvidenceRef,
    duplicateBasis,
  };
}

function reconcileEvent(
  reportId,
  event,
  indexes,
) {
  /*
   * PRECEDENCE 1:
   * Non-operational evidence never reaches the report.
   */
  if (
    event.operationalEligibility !==
    "OPERATIONAL"
  ) {
    return buildDecision({
      reportId,
      event,
      reconciliationOutcome:
        "DISCARD",
      reasonCode:
        "NON_OPERATIONAL_EVENT",
    });
  }

  /*
   * PRECEDENCE 2A:
   * Exact canonical evidence reference.
   */
  const knownByRef =
    indexes.knownByEvidenceRef.get(
      event.evidenceRef,
    );

  if (knownByRef) {
    return buildDecision({
      reportId,
      event,
      reconciliationOutcome:
        "EXACT_DUPLICATE",
      reasonCode:
        "KNOWN_EVIDENCE_REF_MATCH",
      duplicateEvidenceRef:
        knownByRef.evidenceRef,
      duplicateBasis:
        "EVIDENCE_REF",
    });
  }

  /*
   * PRECEDENCE 2B:
   * Same underlying source bytes under another evidence reference.
   */
  if (event.sourceSha256) {
    const knownByHash =
      indexes.knownBySourceSha256.get(
        event.sourceSha256,
      );

    if (knownByHash) {
      return buildDecision({
        reportId,
        event,
        reconciliationOutcome:
          "EXACT_DUPLICATE",
        reasonCode:
          "KNOWN_SOURCE_SHA256_MATCH",
        duplicateEvidenceRef:
          knownByHash.evidenceRef,
        duplicateBasis:
          "SOURCE_SHA256",
      });
    }
  }

  /*
   * PRECEDENCE 3:
   * Only explicit authoritative binding may create LINK_EXISTING.
   */
  const binding =
    indexes.bindingByEvidenceRef.get(
      event.evidenceRef,
    );

  if (binding) {
    return buildDecision({
      reportId,
      event,
      reconciliationOutcome:
        "LINK_EXISTING",
      reasonCode:
        "AUTHORITATIVE_BINDING",
      opportunityId:
        binding.opportunityId,
    });
  }

  /*
   * PRECEDENCE 4:
   * Candidate signals remain non-authoritative.
   * One or more candidate opportunities still means POSSIBLE_MATCH.
   */
  const candidateMatches =
    indexes.candidatesByEventId.get(
      event.eventId,
    ) || [];

  if (candidateMatches.length > 0) {
    return buildDecision({
      reportId,
      event,
      reconciliationOutcome:
        "POSSIBLE_MATCH",
      reasonCode:
        "NON_AUTHORITATIVE_CANDIDATE_MATCH",
      candidateOpportunityIds:
        candidateMatches.map(
          (candidate) =>
            candidate.opportunityId,
        ),
    });
  }

  /*
   * PRECEDENCE 5:
   * Real operational evidence with no previous evidence,
   * authoritative binding or candidate signal remains visible
   * as a new unlinked candidate.
   */
  return buildDecision({
    reportId,
    event,
    reconciliationOutcome:
      "NEW_CANDIDATE",
    reasonCode:
      "NO_EXISTING_MATCH",
  });
}

function buildReconciliation(input) {
  /*
   * Schema + semantic safety boundary first.
   */
  validateReconciliationInput(
    input,
  );

  const indexes =
    buildIndexes(input);

  /*
   * Deterministic processing order:
   * event time, then eventId.
   */
  const events =
    [...input.events].sort(
      (a, b) => {
        const timeDifference =
          new Date(
            a.occurredAt,
          ).getTime() -
          new Date(
            b.occurredAt,
          ).getTime();

        if (
          timeDifference !== 0
        ) {
          return timeDifference;
        }

        return a.eventId.localeCompare(
          b.eventId,
        );
      },
    );

  const decisions =
    events.map(
      (event) =>
        reconcileEvent(
          input.reportId,
          event,
          indexes,
        ),
    );

  const reconciliationFingerprint = [
    "WALLTECH_COLLABORATOR_EVENT_RECONCILIATION_RESULT_V1",
    input.reportId,
    ...decisions.map(
      (decision) =>
        [
          decision.decisionId,
          decision.eventId,
          decision.reconciliationOutcome,
          decision.reasonCode,
        ].join(":"),
    ),
    "CRM_WRITE_FALSE",
    "OPPORTUNITY_CREATION_FALSE",
    "STAGE_MUTATION_FALSE",
    "OWNER_MUTATION_FALSE",
    "COMMERCIAL_STATE_MUTATION_FALSE",
  ].join("\n");

  const result = {
    reconciliationVersion:
      "1.0",
    reconciliationType:
      "COLLABORATOR_EVENT_RECONCILIATION_RESULT",
    reconciliationId:
      `CER-${sha256Text(
        reconciliationFingerprint,
      )}`,
    reportId:
      input.reportId,
    decisionPolicy:
      "DETERMINISTIC_EVIDENCE_BOUND_RECONCILIATION_V1",
    generatedAt:
      new Date().toISOString(),
    decisions,
    counts: {
      inputEvents:
        decisions.length,

      exactDuplicates:
        decisions.filter(
          (decision) =>
            decision
              .reconciliationOutcome ===
            "EXACT_DUPLICATE",
        ).length,

      linkedExisting:
        decisions.filter(
          (decision) =>
            decision
              .reconciliationOutcome ===
            "LINK_EXISTING",
        ).length,

      possibleMatches:
        decisions.filter(
          (decision) =>
            decision
              .reconciliationOutcome ===
            "POSSIBLE_MATCH",
        ).length,

      newCandidates:
        decisions.filter(
          (decision) =>
            decision
              .reconciliationOutcome ===
            "NEW_CANDIDATE",
        ).length,

      discarded:
        decisions.filter(
          (decision) =>
            decision
              .reconciliationOutcome ===
            "DISCARD",
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

  const validateResult =
    compileResultSchema();

  if (!validateResult(result)) {
    throw new Error(
      `COLLABORATOR RECONCILIATION RESULT: INVALID\n${JSON.stringify(
        validateResult.errors,
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
      "Usage: node src/reporting/build-collaborator-reconciliation.js <input.json> [output.json]",
    );
    process.exit(2);
  }

  try {
    const input =
      loadJson(
        inputPath,
        "COLLABORATOR RECONCILIATION INPUT",
      );

    const result =
      buildReconciliation(input);

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
        "COLLABORATOR RECONCILIATION: PASS",
      );
      console.log(
        `REPORT: ${result.reportId}`,
      );
      console.log(
        `RECONCILIATION ID: ${result.reconciliationId}`,
      );
      console.log(
        `INPUT EVENTS: ${result.counts.inputEvents}`,
      );
      console.log(
        `EXACT DUPLICATES: ${result.counts.exactDuplicates}`,
      );
      console.log(
        `LINKED EXISTING: ${result.counts.linkedExisting}`,
      );
      console.log(
        `POSSIBLE MATCHES: ${result.counts.possibleMatches}`,
      );
      console.log(
        `NEW CANDIDATES: ${result.counts.newCandidates}`,
      );
      console.log(
        `DISCARDED: ${result.counts.discarded}`,
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

if (require.main === module) {
  main();
}

module.exports = {
  buildReconciliation,
  reconcileEvent,
};
