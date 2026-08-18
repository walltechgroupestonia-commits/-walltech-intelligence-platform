const fs = require("node:fs");
const path = require("node:path");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const DETECTION_SCHEMA =
  "src/mail/communication-cycle-detection.schema.json";

const SEQUENCE_SCHEMA =
  "src/mail/communication-sequence.schema.json";

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

function normalizeTimestamp(value) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return null;
  }

  const time =
    Date.parse(value);

  if (!Number.isFinite(time)) {
    return null;
  }

  return new Date(time)
    .toISOString();
}

function buildEvent(message) {
  return {
    sequenceIndex: 0,

    evidenceId:
      message.evidenceId,

    observedAt:
      normalizeTimestamp(
        message.date
      ),

    direction:
      message.direction,

    mailboxPath:
      message.mailboxPath,

    uidValidity:
      message.uidValidity,

    uid:
      message.uid,

    messageId:
      message.messageId ?? null,

    subject:
      message.subject ?? null,
  };
}

function compareEvents(a, b) {
  const aHasTimestamp =
    a.observedAt !== null;

  const bHasTimestamp =
    b.observedAt !== null;

  /*
   * Timestamped events are ordered first.
   * Undated evidence is retained, but cannot determine
   * the latest observed timestamped event.
   */
  if (
    aHasTimestamp &&
    !bHasTimestamp
  ) {
    return -1;
  }

  if (
    !aHasTimestamp &&
    bHasTimestamp
  ) {
    return 1;
  }

  if (
    aHasTimestamp &&
    bHasTimestamp
  ) {
    const byTime =
      a.observedAt.localeCompare(
        b.observedAt
      );

    if (byTime !== 0) {
      return byTime;
    }
  }

  /*
   * Deterministic tie-breaker only.
   * Evidence ID does not imply chronology.
   */
  return a.evidenceId.localeCompare(
    b.evidenceId
  );
}

function buildSequence(
  relationship,
  messageIndex
) {
  const evidenceIds =
    relationship.evidenceIds;

  const uniqueEvidenceIds =
    new Set(evidenceIds);

  if (
    uniqueEvidenceIds.size !==
    evidenceIds.length
  ) {
    fail(
      `SEQUENCE LINK ERROR: duplicate evidence ID in ${relationship.candidateRelationshipId}`,
      4
    );
  }

  const events =
    evidenceIds.map(
      (evidenceId) => {
        const message =
          messageIndex.get(
            evidenceId
          );

        if (!message) {
          fail(
            `SEQUENCE LINK ERROR: unknown evidence ID ${evidenceId}`,
            4
          );
        }

        if (
          message.subjectKey !==
          relationship.subjectKey
        ) {
          fail(
            `SEQUENCE LINK ERROR: subjectKey mismatch for ${evidenceId}`,
            4
          );
        }

        return buildEvent(
          message
        );
      }
    );

  if (
    relationship.messageCount !==
    events.length
  ) {
    fail(
      `SEQUENCE LINK ERROR: relationship messageCount mismatch for ${relationship.candidateRelationshipId}`,
      4
    );
  }

  events.sort(compareEvents);

  events.forEach(
    (event, index) => {
      event.sequenceIndex =
        index + 1;
    }
  );

  const timestampedEvents =
    events.filter(
      (event) =>
        event.observedAt !== null
    );

  const timestampedMessageCount =
    timestampedEvents.length;

  const undatedMessageCount =
    events.length -
    timestampedMessageCount;

  const timestampCoverage =
    events.length > 0
      ? timestampedMessageCount /
        events.length
      : 0;

  const orderingComplete =
    undatedMessageCount === 0;

  const latestObservedEvent =
    timestampedEvents.length > 0
      ? timestampedEvents[
          timestampedEvents.length - 1
        ]
      : null;

  return {
    candidateRelationshipId:
      relationship.candidateRelationshipId,

    subjectKey:
      relationship.subjectKey,

    orderingBasis:
      "EVIDENCE_TIMESTAMP",

    messageCount:
      events.length,

    timestampedMessageCount,

    undatedMessageCount,

    timestampCoverage,

    orderingComplete,

    events,

    latestObservedEvent,

    latestObservedDirection:
      latestObservedEvent
        ? latestObservedEvent.direction
        : null,

    latestObservedAt:
      latestObservedEvent
        ? latestObservedEvent.observedAt
        : null,

    latestObservedEvidenceId:
      latestObservedEvent
        ? latestObservedEvent.evidenceId
        : null,
  };
}

function main() {
  const detectionPath =
    process.argv[2];

  const outputPath =
    process.argv[3] || null;

  if (!detectionPath) {
    console.error(
      "Usage: node src/mail/build-communication-sequence.js <detection.json> [sequence.json]"
    );

    process.exit(2);
  }

  const detection =
    loadJson(
      detectionPath,
      "DETECTION"
    );

  const validateDetection =
    compileSchema(
      DETECTION_SCHEMA
    );

  validateOrFail(
    validateDetection,
    detection,
    "COMMUNICATION CYCLE DETECTION",
    3
  );

  const validateSequence =
    compileSchema(
      SEQUENCE_SCHEMA
    );

  const messageIndex =
    new Map();

  for (
    const message of
    detection.messages
  ) {
    if (
      messageIndex.has(
        message.evidenceId
      )
    ) {
      fail(
        `SEQUENCE LINK ERROR: duplicate message evidence ${message.evidenceId}`,
        4
      );
    }

    messageIndex.set(
      message.evidenceId,
      message
    );
  }

  const sequences =
    detection
      .candidateRelationships
      .map(
        (relationship) =>
          buildSequence(
            relationship,
            messageIndex
          )
      )
      .sort(
        (a, b) =>
          a.candidateRelationshipId
            .localeCompare(
              b.candidateRelationshipId
            )
      );

  const result = {
    sequenceVersion: "1.0",

    sequenceType:
      "COMMUNICATION_SEQUENCES",

    source: {
      accountKey:
        detection.source.accountKey,

      mailboxUser:
        detection.source.mailboxUser,

      provider:
        detection.source.provider,

      detectionType:
        detection.detectionType,

      detectionMessageCount:
        detection.messageCount,
    },

    candidateRelationshipCount:
      sequences.length,

    sequences,

    generatedAt:
      new Date().toISOString(),
  };

  validateOrFail(
    validateSequence,
    result,
    "COMMUNICATION SEQUENCE",
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
    "COMMUNICATION SEQUENCE: PASS"
  );

  console.error(
    `RELATIONSHIPS: ${result.candidateRelationshipCount}`
  );

  for (
    const sequence of
    result.sequences
  ) {
    console.error(
      `${sequence.candidateRelationshipId} | ` +
      `MESSAGES=${sequence.messageCount} | ` +
      `TIMESTAMPED=${sequence.timestampedMessageCount} | ` +
      `LATEST=${sequence.latestObservedDirection || "NONE"} | ` +
      `AT=${sequence.latestObservedAt || "NONE"}`
    );
  }
}

main();
