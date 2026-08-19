const fs = require("node:fs");
const path = require("node:path");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const DEFAULT_SCHEMA_PATH =
  "src/reporting/collaborator-reconciliation-input.schema.json";

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

function compileSchema(
  schemaPath = DEFAULT_SCHEMA_PATH,
) {
  const schema =
    loadJson(
      schemaPath,
      "RECONCILIATION INPUT SCHEMA",
    );

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  addFormats(ajv);

  return ajv.compile(schema);
}

function semanticGuard(input) {
  const eventIds = new Set();
  const evidenceRefs = new Set();

  /*
   * The reconciliation batch itself must contain one canonical
   * occurrence of each evidence item.
   *
   * EXACT_DUPLICATE is a reconciliation result against already-known
   * canonical evidence. Peer duplicates inside the same input batch
   * are rejected fail-closed instead of silently choosing a winner.
   */
  const currentEventByEvidenceRef =
    new Map();

  const currentEventBySourceSha256 =
    new Map();

  for (const event of input.events) {
    if (eventIds.has(event.eventId)) {
      throw new Error(
        `DUPLICATE EVENT ID: ${event.eventId}`,
      );
    }

    if (
      currentEventByEvidenceRef.has(
        event.evidenceRef,
      )
    ) {
      const previousEventId =
        currentEventByEvidenceRef.get(
          event.evidenceRef,
        );

      throw new Error(
        `DUPLICATE BATCH EVIDENCE REF: ${event.evidenceRef} (${previousEventId}, ${event.eventId})`,
      );
    }

    if (event.sourceSha256) {
      if (
        currentEventBySourceSha256.has(
          event.sourceSha256,
        )
      ) {
        const previous =
          currentEventBySourceSha256.get(
            event.sourceSha256,
          );

        throw new Error(
          `DUPLICATE BATCH SOURCE SHA256: ${event.sourceSha256} (${previous.eventId}, ${event.eventId})`,
        );
      }

      currentEventBySourceSha256.set(
        event.sourceSha256,
        {
          eventId: event.eventId,
          evidenceRef:
            event.evidenceRef,
        },
      );
    }

    eventIds.add(event.eventId);
    evidenceRefs.add(event.evidenceRef);

    currentEventByEvidenceRef.set(
      event.evidenceRef,
      event.eventId,
    );

    /*
     * A phone note is explicitly user-reported evidence.
     * It must never be silently upgraded to system/direct evidence.
     */
    if (
      event.eventType === "PHONE_NOTE" &&
      event.sourceProvenance !==
        "USER_REPORTED"
    ) {
      throw new Error(
        `PHONE_NOTE REQUIRES USER_REPORTED PROVENANCE: ${event.eventId}`,
      );
    }

    if (
      event.channel === "PHONE" &&
      event.eventType === "PHONE_NOTE" &&
      event.sourceProvenance !==
        "USER_REPORTED"
    ) {
      throw new Error(
        `PHONE EVIDENCE PROVENANCE ERROR: ${event.eventId}`,
      );
    }

    /*
     * A forwarded item must preserve the original evidence reference.
     * The forwarding/transport evidence must be separately identified.
     */
    if (
      event.sourceProvenance ===
        "FORWARDED"
    ) {
      if (!event.transportEvidenceRef) {
        throw new Error(
          `FORWARDED EVENT REQUIRES transportEvidenceRef: ${event.eventId}`,
        );
      }

      if (
        event.transportEvidenceRef ===
        event.evidenceRef
      ) {
        throw new Error(
          `FORWARDED EVENT MUST PRESERVE DISTINCT ORIGINAL EVIDENCE: ${event.eventId}`,
        );
      }
    }

    /*
     * WeTransfer is normally a container.
     * It becomes an operational event only when it proves
     * an actual file transfer.
     */
    if (
      event.channel === "WETRANSFER" &&
      event.operationalEligibility ===
        "OPERATIONAL" &&
      event.eventType !== "FILE_TRANSFER"
    ) {
      throw new Error(
        `OPERATIONAL WETRANSFER REQUIRES FILE_TRANSFER EVENT: ${event.eventId}`,
      );
    }

    /*
     * Non-forwarded events must not carry a forwarding transport reference.
     * This prevents provenance ambiguity.
     */
    if (
      event.sourceProvenance !==
        "FORWARDED" &&
      event.transportEvidenceRef !== null
    ) {
      throw new Error(
        `NON-FORWARDED EVENT CANNOT HAVE transportEvidenceRef: ${event.eventId}`,
      );
    }
  }

  /*
   * Canonical known evidence must not contain conflicting
   * duplicate evidenceRef records.
   */
  const knownEvidenceByRef = new Map();

  for (
    const known
    of input.knownEvidence
  ) {
    if (
      knownEvidenceByRef.has(
        known.evidenceRef,
      )
    ) {
      const previous =
        knownEvidenceByRef.get(
          known.evidenceRef,
        );

      if (
        previous.sourceSha256 !==
        known.sourceSha256
      ) {
        throw new Error(
          `CONFLICTING KNOWN EVIDENCE: ${known.evidenceRef}`,
        );
      }

      throw new Error(
        `DUPLICATE KNOWN EVIDENCE: ${known.evidenceRef}`,
      );
    }

    knownEvidenceByRef.set(
      known.evidenceRef,
      known,
    );
  }

  /*
   * An authoritative binding is allowed only for evidence
   * actually present in the reconciliation batch.
   *
   * One evidence item cannot be authoritatively bound to
   * two different opportunities.
   */
  const bindingByEvidenceRef =
    new Map();

  for (
    const binding
    of input.authoritativeBindings
  ) {
    if (
      !evidenceRefs.has(
        binding.evidenceRef,
      )
    ) {
      throw new Error(
        `AUTHORITATIVE BINDING REFERENCES UNKNOWN EVENT EVIDENCE: ${binding.evidenceRef}`,
      );
    }

    if (
      bindingByEvidenceRef.has(
        binding.evidenceRef,
      )
    ) {
      const previous =
        bindingByEvidenceRef.get(
          binding.evidenceRef,
        );

      if (
        previous.opportunityId !==
        binding.opportunityId
      ) {
        throw new Error(
          `CONFLICTING AUTHORITATIVE BINDING: ${binding.evidenceRef}`,
        );
      }

      throw new Error(
        `DUPLICATE AUTHORITATIVE BINDING: ${binding.evidenceRef}`,
      );
    }

    bindingByEvidenceRef.set(
      binding.evidenceRef,
      binding,
    );
  }

  /*
   * Candidate matches are explicitly non-authoritative.
   * They may point only to events in this batch.
   *
   * Multiple different opportunities for the same event are
   * allowed: this represents genuine ambiguity and must never
   * be collapsed automatically into LINK_EXISTING.
   */
  const candidateKeys = new Set();

  for (
    const candidate
    of input.candidateMatches
  ) {
    if (
      !eventIds.has(
        candidate.eventId,
      )
    ) {
      throw new Error(
        `CANDIDATE MATCH REFERENCES UNKNOWN EVENT: ${candidate.eventId}`,
      );
    }

    const key = [
      candidate.eventId,
      candidate.opportunityId,
      candidate.matchBasis,
    ].join("::");

    if (candidateKeys.has(key)) {
      throw new Error(
        `DUPLICATE CANDIDATE MATCH: ${key}`,
      );
    }

    candidateKeys.add(key);
  }

  return true;
}

function validateReconciliationInput(
  input,
  schemaPath = DEFAULT_SCHEMA_PATH,
) {
  const validate =
    compileSchema(schemaPath);

  if (!validate(input)) {
    throw new Error(
      `COLLABORATOR RECONCILIATION INPUT: INVALID\n${JSON.stringify(
        validate.errors,
        null,
        2,
      )}`,
    );
  }

  semanticGuard(input);

  return true;
}

function main() {
  const inputPath =
    process.argv[2];

  const schemaPath =
    process.argv[3] ||
    DEFAULT_SCHEMA_PATH;

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/validate-collaborator-reconciliation-input.js <input.json> [schema.json]",
    );
    process.exit(2);
  }

  try {
    const input =
      loadJson(
        inputPath,
        "COLLABORATOR RECONCILIATION INPUT",
      );

    validateReconciliationInput(
      input,
      schemaPath,
    );

    console.log(
      "COLLABORATOR RECONCILIATION INPUT: VALID",
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
  semanticGuard,
  validateReconciliationInput,
};
