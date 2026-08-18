const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const SEQUENCE_SCHEMA =
  "src/mail/communication-sequence.schema.json";

const RESPONSE_STATE_SCHEMA =
  "src/mail/response-state-evidence.schema.json";

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function loadJson(filePath, label) {
  const absolute = path.resolve(
    process.cwd(),
    filePath
  );

  if (!fs.existsSync(absolute)) {
    fail(
      `${label} NOT FOUND: ${filePath}`,
      2
    );
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        absolute,
        "utf8"
      )
    );
  } catch (error) {
    fail(
      `${label} INVALID JSON: ${filePath}\n${error.message}`,
      2
    );
  }
}

function compileSchema(schemaPath) {
  const schema = loadJson(
    schemaPath,
    "SCHEMA"
  );

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  addFormats(ajv);

  try {
    return ajv.compile(schema);
  } catch (error) {
    fail(
      `SCHEMA COMPILE ERROR: ${schemaPath}\n${error.message}`,
      3
    );
  }
}

function validateOrFail(
  validator,
  object,
  label,
  exitCode
) {
  if (validator(object)) {
    return;
  }

  console.error(
    `${label}: INVALID`
  );

  console.error(
    JSON.stringify(
      validator.errors,
      null,
      2
    )
  );

  process.exit(exitCode);
}

function sha256Text(value) {
  return crypto
    .createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function evidenceQuality(sequence) {
  if (
    sequence.timestampedMessageCount === 0
  ) {
    return "NO_TIMESTAMPED_EVENTS";
  }

  if (
    sequence.orderingComplete === true &&
    sequence.timestampCoverage === 1
  ) {
    return "COMPLETE_TIMESTAMP_ORDERING";
  }

  return "PARTIAL_TIMESTAMP_ORDERING";
}

function observedState(direction) {
  switch (direction) {
    case "INBOUND":
      return "LATEST_INBOUND";

    case "OUTBOUND":
      return "LATEST_OUTBOUND";

    case "SELF":
      return "LATEST_SELF";

    case "AMBIGUOUS":
      return "LATEST_AMBIGUOUS";

    default:
      return "NO_TIMESTAMPED_EVENT";
  }
}

function verifySequenceIntegrity(sequence) {
  if (
    sequence.messageCount !==
    sequence.events.length
  ) {
    fail(
      `RESPONSE-STATE LINK ERROR: messageCount mismatch for ${sequence.candidateRelationshipId}`,
      4
    );
  }

  const timestamped =
    sequence.events.filter(
      (event) =>
        event.observedAt !== null
    );

  if (
    timestamped.length !==
    sequence.timestampedMessageCount
  ) {
    fail(
      `RESPONSE-STATE LINK ERROR: timestampedMessageCount mismatch for ${sequence.candidateRelationshipId}`,
      4
    );
  }

  const expectedUndated =
    sequence.events.length -
    timestamped.length;

  if (
    expectedUndated !==
    sequence.undatedMessageCount
  ) {
    fail(
      `RESPONSE-STATE LINK ERROR: undatedMessageCount mismatch for ${sequence.candidateRelationshipId}`,
      4
    );
  }

  const expectedCoverage =
    sequence.events.length > 0
      ? timestamped.length /
        sequence.events.length
      : 0;

  if (
    Math.abs(
      expectedCoverage -
      sequence.timestampCoverage
    ) > Number.EPSILON
  ) {
    fail(
      `RESPONSE-STATE LINK ERROR: timestampCoverage mismatch for ${sequence.candidateRelationshipId}`,
      4
    );
  }

  const expectedOrderingComplete =
    expectedUndated === 0;

  if (
    sequence.orderingComplete !==
    expectedOrderingComplete
  ) {
    fail(
      `RESPONSE-STATE LINK ERROR: orderingComplete mismatch for ${sequence.candidateRelationshipId}`,
      4
    );
  }

  if (timestamped.length === 0) {
    if (
      sequence.latestObservedEvent !== null ||
      sequence.latestObservedDirection !== null ||
      sequence.latestObservedAt !== null ||
      sequence.latestObservedEvidenceId !== null
    ) {
      fail(
        `RESPONSE-STATE LINK ERROR: latest observed fields must be null when no timestamped event exists for ${sequence.candidateRelationshipId}`,
        4
      );
    }

    return;
  }

  const latest =
    [...timestamped]
      .sort((a, b) => {
        const byTime =
          a.observedAt.localeCompare(
            b.observedAt
          );

        if (byTime !== 0) {
          return byTime;
        }

        return a.evidenceId.localeCompare(
          b.evidenceId
        );
      })
      .at(-1);

  if (
    sequence.latestObservedEvidenceId !==
    latest.evidenceId
  ) {
    fail(
      `RESPONSE-STATE LINK ERROR: latestObservedEvidenceId mismatch for ${sequence.candidateRelationshipId}`,
      4
    );
  }

  if (
    sequence.latestObservedDirection !==
    latest.direction
  ) {
    fail(
      `RESPONSE-STATE LINK ERROR: latestObservedDirection mismatch for ${sequence.candidateRelationshipId}`,
      4
    );
  }

  if (
    sequence.latestObservedAt !==
    latest.observedAt
  ) {
    fail(
      `RESPONSE-STATE LINK ERROR: latestObservedAt mismatch for ${sequence.candidateRelationshipId}`,
      4
    );
  }

  if (
    sequence.latestObservedEvent
      ?.evidenceId !==
    latest.evidenceId
  ) {
    fail(
      `RESPONSE-STATE LINK ERROR: latestObservedEvent mismatch for ${sequence.candidateRelationshipId}`,
      4
    );
  }
}

function buildRelationship(sequence) {
  verifySequenceIntegrity(
    sequence
  );

  const state =
    observedState(
      sequence.latestObservedDirection
    );

  const fingerprint = [
    "WALLTECH_RESPONSE_STATE_EVIDENCE_V1",
    sequence.candidateRelationshipId,
    sequence.latestObservedEvidenceId ||
      "NO_LATEST_EVIDENCE",
    state,
    "RESPONSE_EXPECTATION_UNDETERMINED",
  ].join("\n");

  return {
    responseStateEvidenceId:
      `RSE-${sha256Text(
        fingerprint
      )}`,

    candidateRelationshipId:
      sequence.candidateRelationshipId,

    subjectKey:
      sequence.subjectKey,

    sequenceMessageCount:
      sequence.messageCount,

    sequenceEvidenceQuality:
      evidenceQuality(sequence),

    orderingComplete:
      sequence.orderingComplete,

    timestampCoverage:
      sequence.timestampCoverage,

    latestObservedDirection:
      sequence.latestObservedDirection,

    latestObservedAt:
      sequence.latestObservedAt,

    latestObservedEvidenceId:
      sequence.latestObservedEvidenceId,

    observedState:
      state,

    /*
     * Sequence evidence establishes chronology only.
     * It contains no evidence that a reply was requested,
     * promised, contractually required or otherwise expected.
     */
    responseExpectationEvidenceAvailable:
      false,

    responseExpectationDetermination:
      "UNDETERMINED",

    responseExpectationBasis:
      "NO_RESPONSE_OBLIGATION_EVIDENCE_IN_SEQUENCE_V1",

    /*
     * An unanswered determination requires prior proof
     * that a response was actually expected.
     */
    unansweredDetermination:
      "UNDETERMINED",

    unansweredBasis:
      "REQUIRES_RESPONSE_EXPECTATION_EVIDENCE",

    /*
     * Follow-up determination is a later policy layer.
     */
    followUpDetermination:
      "UNDETERMINED",

    followUpBasis:
      "REQUIRES_RESPONSE_STATE_AND_FOLLOW_UP_POLICY",

    commercialStateInference:
      "NONE",
  };
}

function main() {
  const sequencePath =
    process.argv[2];

  const outputPath =
    process.argv[3] || null;

  if (!sequencePath) {
    console.error(
      "Usage: node src/mail/build-response-state-evidence.js <sequence.json> [response-state.json]"
    );

    process.exit(2);
  }

  const sequence =
    loadJson(
      sequencePath,
      "COMMUNICATION SEQUENCE"
    );

  const validateSequence =
    compileSchema(
      SEQUENCE_SCHEMA
    );

  validateOrFail(
    validateSequence,
    sequence,
    "COMMUNICATION SEQUENCE",
    3
  );

  const validateResponseState =
    compileSchema(
      RESPONSE_STATE_SCHEMA
    );

  const relationships =
    sequence.sequences
      .map(buildRelationship)
      .sort(
        (a, b) =>
          a.responseStateEvidenceId
            .localeCompare(
              b.responseStateEvidenceId
            )
      );

  const result = {
    responseStateVersion:
      "1.0",

    responseStateType:
      "RESPONSE_STATE_EVIDENCE",

    source: {
      accountKey:
        sequence.source.accountKey,

      mailboxUser:
        sequence.source.mailboxUser,

      provider:
        sequence.source.provider,

      sequenceType:
        sequence.sequenceType,

      sequenceRelationshipCount:
        sequence.candidateRelationshipCount,
    },

    relationshipCount:
      relationships.length,

    relationships,

    generatedAt:
      new Date().toISOString(),
  };

  validateOrFail(
    validateResponseState,
    result,
    "RESPONSE-STATE EVIDENCE",
    5
  );

  const json =
    JSON.stringify(
      result,
      null,
      2
    ) + "\n";

  if (outputPath) {
    const absolute =
      path.resolve(
        process.cwd(),
        outputPath
      );

    fs.mkdirSync(
      path.dirname(absolute),
      {
        recursive: true,
      }
    );

    fs.writeFileSync(
      absolute,
      json
    );
  } else {
    process.stdout.write(json);
  }

  console.error("");
  console.error(
    "RESPONSE-STATE EVIDENCE: PASS"
  );

  console.error(
    `RELATIONSHIPS: ${result.relationshipCount}`
  );

  for (
    const relationship of
    result.relationships
  ) {
    console.error(
      `${relationship.responseStateEvidenceId} | ` +
      `${relationship.observedState} | ` +
      `RESPONSE=${relationship.responseExpectationDetermination} | ` +
      `UNANSWERED=${relationship.unansweredDetermination} | ` +
      `FOLLOW-UP=${relationship.followUpDetermination}`
    );
  }
}

main();
