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

const SEQUENCE_SCHEMA =
  "src/mail/communication-sequence.schema.json";

const RESPONSE_EXPECTATION_SCHEMA =
  "src/mail/response-expectation-evidence.schema.json";

const RELATIONSHIP_SCHEMA =
  "src/mail/relationship-response-expectation.schema.json";

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function loadJson(filePath, label) {
  const absolute =
    path.resolve(
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
  const schema =
    loadJson(
      schemaPath,
      "SCHEMA"
    );

  const ajv =
    new Ajv2020({
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
  value,
  label,
  exitCode
) {
  if (validator(value)) {
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

function expectedDirection(
  expectedResponder
) {
  if (
    expectedResponder ===
    "COUNTERPARTY"
  ) {
    return "INBOUND";
  }

  if (
    expectedResponder ===
    "WALLTECH"
  ) {
    return "OUTBOUND";
  }

  return null;
}

function validateExpectationSemantics(
  evidence
) {
  if (
    evidence.determination ===
    "EXPECTED"
  ) {
    if (
      ![
        "COUNTERPARTY",
        "WALLTECH",
      ].includes(
        evidence.expectedResponder
      )
    ) {
      fail(
        `RELATIONSHIP EXPECTATION LINK ERROR: EXPECTED evidence has invalid responder ${evidence.responseExpectationEvidenceId}`,
        4
      );
    }

    if (
      evidence.explicitSignalCount <
      1
    ) {
      fail(
        `RELATIONSHIP EXPECTATION LINK ERROR: EXPECTED evidence has no explicit signal ${evidence.responseExpectationEvidenceId}`,
        4
      );
    }
  }

  if (
    evidence.determination ===
    "NOT_ESTABLISHED" &&
    evidence.expectedResponder !==
      "NONE"
  ) {
    fail(
      `RELATIONSHIP EXPECTATION LINK ERROR: NOT_ESTABLISHED evidence has responder ${evidence.responseExpectationEvidenceId}`,
      4
    );
  }

  if (
    evidence.determination ===
    "AMBIGUOUS" &&
    evidence.expectedResponder !==
      "UNKNOWN"
  ) {
    fail(
      `RELATIONSHIP EXPECTATION LINK ERROR: AMBIGUOUS evidence has non-UNKNOWN responder ${evidence.responseExpectationEvidenceId}`,
      4
    );
  }
}

function buildRelationship(
  sequence,
  reeIndex
) {
  const events =
    sequence.events.map(
      (event) => {
        const ree =
          reeIndex.get(
            event.evidenceId
          );

        if (!ree) {
          fail(
            `RELATIONSHIP EXPECTATION LINK ERROR: missing REE for ${event.evidenceId}`,
            4
          );
        }

        validateExpectationSemantics(
          ree
        );

        if (
          ree.message.direction !==
          event.direction
        ) {
          fail(
            `RELATIONSHIP EXPECTATION LINK ERROR: direction mismatch for ${event.evidenceId}`,
            4
          );
        }

        if (
          ree.message.messageId !==
          event.messageId
        ) {
          fail(
            `RELATIONSHIP EXPECTATION LINK ERROR: Message-ID mismatch for ${event.evidenceId}`,
            4
          );
        }

        if (
          ree.message.subject !==
          event.subject
        ) {
          fail(
            `RELATIONSHIP EXPECTATION LINK ERROR: subject mismatch for ${event.evidenceId}`,
            4
          );
        }

        return {
          sequenceIndex:
            event.sequenceIndex,

          observedAt:
            event.observedAt,

          direction:
            event.direction,

          mailEvidenceId:
            event.evidenceId,

          responseExpectationEvidenceId:
            ree.responseExpectationEvidenceId,

          determination:
            ree.determination,

          expectedResponder:
            ree.expectedResponder,

          explicitSignalCount:
            ree.explicitSignalCount,

          basis:
            ree.basis,
        };
      }
    );

  const expectations = [];

  let ambiguousEvidencePresent =
    false;

  for (const event of events) {
    if (
      event.determination ===
      "AMBIGUOUS"
    ) {
      ambiguousEvidencePresent =
        true;

      continue;
    }

    if (
      event.determination !==
      "EXPECTED"
    ) {
      continue;
    }

    const responseDirection =
      expectedDirection(
        event.expectedResponder
      );

    if (!responseDirection) {
      ambiguousEvidencePresent =
        true;

      continue;
    }

    const later =
      events.find(
        (candidate) =>
          candidate.sequenceIndex >
            event.sequenceIndex &&
          candidate.direction ===
            responseDirection
      ) || null;

    expectations.push({
      sourceSequenceIndex:
        event.sequenceIndex,

      sourceMailEvidenceId:
        event.mailEvidenceId,

      sourceResponseExpectationEvidenceId:
        event.responseExpectationEvidenceId,

      expectedResponder:
        event.expectedResponder,

      expectedResponseDirection:
        responseDirection,

      laterExpectedResponderMessageObserved:
        Boolean(later),

      laterObservedSequenceIndex:
        later
          ? later.sequenceIndex
          : null,

      laterObservedMailEvidenceId:
        later
          ? later.mailEvidenceId
          : null,

      laterObservedAt:
        later
          ? later.observedAt
          : null,

      /*
       * Direction and chronology can prove that a later
       * message exists, but they cannot prove the request
       * was semantically satisfied.
       */
      semanticSatisfactionDetermination:
        "UNDETERMINED",
    });
  }

  const establishedExpectationCount =
    expectations.length;

  const openExpectationCount =
    expectations.filter(
      (item) =>
        !item
          .laterExpectedResponderMessageObserved
    ).length;

  const laterResponseObservedCount =
    expectations.filter(
      (item) =>
        item
          .laterExpectedResponderMessageObserved
    ).length;

  let relationshipDetermination;

  if (ambiguousEvidencePresent) {
    relationshipDetermination =
      "AMBIGUOUS_EXPECTATION";
  } else if (
    establishedExpectationCount === 0
  ) {
    relationshipDetermination =
      "NO_EXPLICIT_EXPECTATION";
  } else if (
    openExpectationCount > 0
  ) {
    relationshipDetermination =
      "OPEN_EXPECTATION_NO_LATER_RESPONSE";
  } else {
    relationshipDetermination =
      "LATER_RESPONSE_OBSERVED";
  }

  const fingerprint = [
    "WALLTECH_RELATIONSHIP_RESPONSE_EXPECTATION_V1",
    sequence.candidateRelationshipId,
    relationshipDetermination,
    ...events.map(
      (event) =>
        [
          event.sequenceIndex,
          event.mailEvidenceId,
          event.responseExpectationEvidenceId,
          event.determination,
          event.expectedResponder,
        ].join(":")
    ),
    ...expectations.map(
      (item) =>
        [
          item.sourceSequenceIndex,
          item.sourceMailEvidenceId,
          item.expectedResponder,
          item.laterExpectedResponderMessageObserved
            ? "LATER_RESPONSE"
            : "NO_LATER_RESPONSE",
          item.laterObservedMailEvidenceId ||
            "NONE",
        ].join(":")
    ),
  ].join("\n");

  return {
    relationshipResponseExpectationId:
      `RRE-${sha256Text(
        fingerprint
      )}`,

    candidateRelationshipId:
      sequence.candidateRelationshipId,

    subjectKey:
      sequence.subjectKey,

    sequenceMessageCount:
      sequence.messageCount,

    eventExpectationCount:
      events.length,

    events,

    establishedExpectationCount,

    openExpectationCount,

    laterResponseObservedCount,

    expectations,

    relationshipDetermination,

    semanticSatisfactionInference:
      "NONE",

    unansweredInference:
      "NONE",

    automaticFollowUpInference:
      "NONE",

    commercialStateInference:
      "NONE",
  };
}

function main() {
  const sequencePath =
    process.argv[2];

  const outputPath =
    process.argv[3];

  const reePaths =
    process.argv.slice(4);

  if (
    !sequencePath ||
    !outputPath ||
    reePaths.length < 1
  ) {
    console.error(
      "Usage: node src/mail/build-relationship-response-expectation.js <sequence.json> <output.json> <ree.json> [more-ree.json ...]"
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

  const validateRee =
    compileSchema(
      RESPONSE_EXPECTATION_SCHEMA
    );

  const reeIndex =
    new Map();

  for (const reePath of reePaths) {
    const ree =
      loadJson(
        reePath,
        "RESPONSE EXPECTATION EVIDENCE"
      );

    validateOrFail(
      validateRee,
      ree,
      `RESPONSE EXPECTATION EVIDENCE ${reePath}`,
      3
    );

    if (
      ree.source.accountKey !==
      sequence.source.accountKey
    ) {
      fail(
        `RELATIONSHIP EXPECTATION SOURCE ERROR: accountKey mismatch in ${reePath}`,
        4
      );
    }

    if (
      String(
        ree.source.mailboxUser
      ).toLowerCase() !==
      String(
        sequence.source.mailboxUser
      ).toLowerCase()
    ) {
      fail(
        `RELATIONSHIP EXPECTATION SOURCE ERROR: mailboxUser mismatch in ${reePath}`,
        4
      );
    }

    const mailEvidenceId =
      ree.source.mailEvidenceId;

    if (
      reeIndex.has(
        mailEvidenceId
      )
    ) {
      fail(
        `RELATIONSHIP EXPECTATION LINK ERROR: duplicate REE for ${mailEvidenceId}`,
        4
      );
    }

    reeIndex.set(
      mailEvidenceId,
      ree
    );
  }

  const sequenceEvidenceIds =
    new Set(
      sequence.sequences.flatMap(
        (item) =>
          item.events.map(
            (event) =>
              event.evidenceId
          )
      )
    );

  for (
    const mailEvidenceId of
    reeIndex.keys()
  ) {
    if (
      !sequenceEvidenceIds.has(
        mailEvidenceId
      )
    ) {
      fail(
        `RELATIONSHIP EXPECTATION LINK ERROR: REE does not belong to sequence ${mailEvidenceId}`,
        4
      );
    }
  }

  if (
    reeIndex.size !==
    sequenceEvidenceIds.size
  ) {
    fail(
      `RELATIONSHIP EXPECTATION LINK ERROR: expected ${sequenceEvidenceIds.size} REE objects, received ${reeIndex.size}`,
      4
    );
  }

  const relationships =
    sequence.sequences
      .map(
        (item) =>
          buildRelationship(
            item,
            reeIndex
          )
      )
      .sort(
        (a, b) =>
          a
            .candidateRelationshipId
            .localeCompare(
              b
                .candidateRelationshipId
            )
      );

  const result = {
    relationshipExpectationVersion:
      "1.0",

    relationshipExpectationType:
      "RELATIONSHIP_RESPONSE_EXPECTATION",

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
        sequence
          .candidateRelationshipCount,

      responseExpectationEvidenceCount:
        reeIndex.size,
    },

    relationshipCount:
      relationships.length,

    relationships,

    generatedAt:
      new Date().toISOString(),
  };

  const validateRelationship =
    compileSchema(
      RELATIONSHIP_SCHEMA
    );

  validateOrFail(
    validateRelationship,
    result,
    "RELATIONSHIP RESPONSE EXPECTATION",
    5
  );

  const absoluteOutput =
    path.resolve(
      process.cwd(),
      outputPath
    );

  fs.mkdirSync(
    path.dirname(
      absoluteOutput
    ),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    absoluteOutput,
    JSON.stringify(
      result,
      null,
      2
    ) + "\n"
  );

  console.error("");
  console.error(
    "RELATIONSHIP RESPONSE EXPECTATION: PASS"
  );

  for (
    const relationship of
    relationships
  ) {
    console.error(
      `${relationship.relationshipResponseExpectationId} | ` +
      `${relationship.relationshipDetermination} | ` +
      `EXPECTED=${relationship.establishedExpectationCount} | ` +
      `OPEN=${relationship.openExpectationCount} | ` +
      `LATER_RESPONSE=${relationship.laterResponseObservedCount}`
    );
  }
}

main();
