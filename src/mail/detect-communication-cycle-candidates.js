const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const MAIL_EVIDENCE_SCHEMA =
  "src/mail/mail-evidence.schema.json";

const DETECTION_SCHEMA =
  "src/mail/communication-cycle-detection.schema.json";

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

  console.error(`${label}: INVALID`);
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

function lowerEmail(value) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const email =
    value.trim().toLowerCase();

  return email || null;
}

function addressesFrom(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((entry) =>
      lowerEmail(entry?.address)
    )
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [
    ...new Set(values),
  ].sort();
}

function normalizeSubject(subject) {
  let value =
    typeof subject === "string"
      ? subject.normalize("NFKC").trim()
      : "";

  /*
   * Remove conventional reply/forward prefixes repeatedly.
   * This is threading evidence only, not semantic interpretation.
   */
  let previous;

  do {
    previous = value;

    value = value.replace(
      /^\s*(?:(?:re|fw|fwd)\s*:\s*)/i,
      ""
    );
  } while (value !== previous);

  value = value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return value;
}

function externalAddresses(
  evidence,
  mailboxUser
) {
  const own =
    mailboxUser.toLowerCase();

  const all = [
    ...addressesFrom(
      evidence.participants?.from
    ),
    ...addressesFrom(
      evidence.participants?.to
    ),
    ...addressesFrom(
      evidence.participants?.cc
    ),
    ...addressesFrom(
      evidence.participants?.replyTo
    ),
  ];

  return uniqueSorted(
    all.filter(
      (address) =>
        address !== own
    )
  );
}

function detectDirection(
  evidence,
  mailboxUser
) {
  const own =
    mailboxUser.toLowerCase();

  const from =
    addressesFrom(
      evidence.participants?.from
    );

  const recipients = [
    ...addressesFrom(
      evidence.participants?.to
    ),
    ...addressesFrom(
      evidence.participants?.cc
    ),
  ];

  const fromOwn =
    from.includes(own);

  const recipientOwn =
    recipients.includes(own);

  const external =
    externalAddresses(
      evidence,
      mailboxUser
    );

  if (
    fromOwn &&
    external.length > 0
  ) {
    return "OUTBOUND";
  }

  if (
    !fromOwn &&
    recipientOwn
  ) {
    return "INBOUND";
  }

  if (
    fromOwn &&
    external.length === 0
  ) {
    return "SELF";
  }

  return "AMBIGUOUS";
}

function assertCommonSource(
  evidenceRecords
) {
  const first =
    evidenceRecords[0];

  const expected = {
    accountKey:
      first.source.accountKey,
    mailboxUser:
      String(
        first.source.mailboxUser
      ).toLowerCase(),
    provider:
      first.source.provider,
  };

  for (
    const evidence of
    evidenceRecords
  ) {
    if (
      evidence.source.accountKey !==
      expected.accountKey
    ) {
      fail(
        "DETECTION SOURCE ERROR: MailEvidence accountKey mismatch",
        4
      );
    }

    if (
      String(
        evidence.source.mailboxUser
      ).toLowerCase() !==
      expected.mailboxUser
    ) {
      fail(
        "DETECTION SOURCE ERROR: MailEvidence mailboxUser mismatch",
        4
      );
    }

    if (
      evidence.source.provider !==
      expected.provider
    ) {
      fail(
        "DETECTION SOURCE ERROR: MailEvidence provider mismatch",
        4
      );
    }
  }

  return expected;
}

function buildMessageSignal(
  evidence,
  mailboxUser
) {
  const subjectKey =
    normalizeSubject(
      evidence.identity?.subject
    ) ||
    `no-subject:${evidence.evidenceId}`;

  return {
    evidenceId:
      evidence.evidenceId,

    mailboxPath:
      evidence.source.mailboxPath,

    uidValidity:
      evidence.source.uidValidity,

    uid:
      evidence.source.uid,

    messageId:
      evidence.identity.messageId ??
      null,

    date:
      evidence.identity.date ??
      evidence.identity.internalDate ??
      null,

    subject:
      evidence.identity.subject ??
      null,

    subjectKey,

    direction:
      detectDirection(
        evidence,
        mailboxUser
      ),

    externalAddresses:
      externalAddresses(
        evidence,
        mailboxUser
      ),
  };
}

function buildCandidateRelationships(
  messages,
  source
) {
  const groups = new Map();

  for (const message of messages) {
    if (
      !groups.has(
        message.subjectKey
      )
    ) {
      groups.set(
        message.subjectKey,
        []
      );
    }

    groups
      .get(message.subjectKey)
      .push(message);
  }

  const relationships = [];

  for (
    const [subjectKey, group]
    of groups.entries()
  ) {
    const evidenceIds =
      uniqueSorted(
        group.map(
          (message) =>
            message.evidenceId
        )
      );

    const external =
      uniqueSorted(
        group.flatMap(
          (message) =>
            message.externalAddresses
        )
      );

    const directions =
      uniqueSorted(
        group.map(
          (message) =>
            message.direction
        )
      );

    const inboundCount =
      group.filter(
        (message) =>
          message.direction ===
          "INBOUND"
      ).length;

    const outboundCount =
      group.filter(
        (message) =>
          message.direction ===
          "OUTBOUND"
      ).length;

    const selfCount =
      group.filter(
        (message) =>
          message.direction ===
          "SELF"
      ).length;

    const ambiguousCount =
      group.filter(
        (message) =>
          message.direction ===
          "AMBIGUOUS"
      ).length;

    const fingerprint = [
      "WALLTECH_COMMUNICATION_RELATIONSHIP_CANDIDATE_V1",
      source.accountKey,
      source.mailboxUser,
      subjectKey,
    ].join("\n");

    relationships.push({
      candidateRelationshipId:
        `CCR-${sha256Text(
          fingerprint
        )}`,

      subjectKey,

      evidenceIds,

      externalAddresses:
        external,

      directionsObserved:
        directions,

      messageCount:
        group.length,

      inboundCount,

      outboundCount,

      selfCount,

      ambiguousCount,

      /*
       * Merely records that evidence exists in both directions.
       * It does NOT mean a cycle is complete or a response obligation
       * has been satisfied.
       */
      exchangeObserved:
        inboundCount > 0 &&
        outboundCount > 0,
    });
  }

  return relationships.sort(
    (a, b) =>
      a.candidateRelationshipId
        .localeCompare(
          b.candidateRelationshipId
        )
  );
}

function main() {
  const evidencePaths =
    process.argv.slice(2);

  if (
    evidencePaths.length < 1
  ) {
    console.error(
      "Usage: node src/mail/detect-communication-cycle-candidates.js <mail-evidence.json> [more-mail-evidence.json ...]"
    );
    process.exit(2);
  }

  const validateMailEvidence =
    compileSchema(
      MAIL_EVIDENCE_SCHEMA
    );

  const validateDetection =
    compileSchema(
      DETECTION_SCHEMA
    );

  const evidenceRecords =
    evidencePaths.map(
      (evidencePath) => {
        const evidence =
          loadJson(
            evidencePath,
            "MAIL EVIDENCE"
          );

        validateOrFail(
          validateMailEvidence,
          evidence,
          `MAIL EVIDENCE ${evidencePath}`,
          3
        );

        return evidence;
      }
    );

  const commonSource =
    assertCommonSource(
      evidenceRecords
    );

  const messages =
    evidenceRecords
      .map(
        (evidence) =>
          buildMessageSignal(
            evidence,
            commonSource.mailboxUser
          )
      )
      .sort((a, b) => {
        const byDate =
          String(a.date || "")
            .localeCompare(
              String(b.date || "")
            );

        if (byDate !== 0) {
          return byDate;
        }

        return a.evidenceId
          .localeCompare(
            b.evidenceId
          );
      });

  const candidateRelationships =
    buildCandidateRelationships(
      messages,
      commonSource
    );

  const result = {
    detectionVersion: "1.0",
    detectionType:
      "COMMUNICATION_CYCLE_CANDIDATES",

    source: {
      accountKey:
        commonSource.accountKey,

      mailboxUser:
        commonSource.mailboxUser,

      provider:
        commonSource.provider,

      evidenceCount:
        evidenceRecords.length,
    },

    messageCount:
      messages.length,

    messages,

    candidateRelationshipCount:
      candidateRelationships.length,

    candidateRelationships,

    generatedAt:
      new Date().toISOString(),
  };

  validateOrFail(
    validateDetection,
    result,
    "COMMUNICATION CYCLE DETECTION",
    5
  );

  process.stdout.write(
    JSON.stringify(
      result,
      null,
      2
    ) + "\n"
  );

  console.error("");
  console.error(
    "COMMUNICATION CYCLE DETECTION: PASS"
  );
  console.error(
    `EVIDENCE: ${result.source.evidenceCount}`
  );
  console.error(
    `MESSAGES: ${result.messageCount}`
  );
  console.error(
    `CANDIDATE RELATIONSHIPS: ${result.candidateRelationshipCount}`
  );

  for (
    const relationship of
    result.candidateRelationships
  ) {
    console.error(
      `${relationship.candidateRelationshipId} | ` +
      `${relationship.subjectKey} | ` +
      `IN=${relationship.inboundCount} | ` +
      `OUT=${relationship.outboundCount} | ` +
      `EXCHANGE=${relationship.exchangeObserved}`
    );
  }
}

main();
