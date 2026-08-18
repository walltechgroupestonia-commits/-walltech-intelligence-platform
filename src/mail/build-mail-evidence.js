const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const DEFAULT_SCHEMA_PATH =
  "src/mail/mail-evidence.schema.json";

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
    fail(`${label} NOT FOUND: ${filePath}`, 2);
  }

  try {
    return JSON.parse(
      fs.readFileSync(absolute, "utf8")
    );
  } catch (error) {
    fail(
      `${label} INVALID JSON: ${filePath}\n${error.message}`,
      2
    );
  }
}

function invariant(condition, message) {
  if (!condition) {
    fail(`EVIDENCE LINK ERROR: ${message}`, 3);
  }
}

function sha256Text(value) {
  return crypto
    .createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function isSha256(value) {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{64}$/.test(value)
  );
}

function buildEvidence(
  acquisition,
  normalized
) {
  invariant(
    acquisition.acquisitionType ===
      "MESSAGE_CONTENT_BY_UID",
    "acquisitionType must be MESSAGE_CONTENT_BY_UID"
  );

  invariant(
    acquisition.sourceType === "IMAP",
    "sourceType must be IMAP"
  );

  invariant(
    acquisition.accessMode === "READ_ONLY",
    "acquisition must be READ_ONLY"
  );

  invariant(
    acquisition.mailboxReadOnly === true,
    "mailbox server state must be READ_ONLY"
  );

  invariant(
    acquisition.selectorType === "UID",
    "selectorType must be UID"
  );

  invariant(
    Number.isInteger(acquisition.uid) &&
      acquisition.uid > 0,
    "UID must be a positive integer"
  );

  invariant(
    typeof acquisition.uidValidity ===
      "string" &&
      /^[0-9]+$/.test(
        acquisition.uidValidity
      ),
    "UIDVALIDITY must be present"
  );

  invariant(
    acquisition.flagsUnchanged === true,
    "IMAP flags must remain unchanged"
  );

  invariant(
    isSha256(acquisition.sourceSha256),
    "raw source SHA-256 invalid"
  );

  invariant(
    normalized.normalizationType ===
      "RFC822_NORMALIZED_CONTENT",
    "normalizationType mismatch"
  );

  invariant(
    normalized.rawEvidence.sourceSha256 ===
      acquisition.sourceSha256,
    "raw SHA-256 mismatch between acquisition and normalization"
  );

  invariant(
    normalized.rawEvidence.sourceBytes ===
      acquisition.sourceBytes,
    "raw byte count mismatch between acquisition and normalization"
  );

  invariant(
    normalized.identity.messageId ===
      acquisition.messageId,
    "Message-ID mismatch"
  );

  invariant(
    normalized.identity.subject ===
      acquisition.subject,
    "subject mismatch"
  );

  if (normalized.content.textPresent) {
    invariant(
      isSha256(
        normalized.content.textSha256
      ),
      "text is present but text SHA-256 is missing"
    );
  }

  if (normalized.content.htmlPresent) {
    invariant(
      isSha256(
        normalized.content.htmlSha256
      ),
      "HTML is present but HTML SHA-256 is missing"
    );
  }

  const attachments =
    Array.isArray(normalized.attachments)
      ? normalized.attachments.map(
          (attachment) => {
            invariant(
              attachment.contentStored ===
                false,
              "attachment binary storage contract violated"
            );

            invariant(
              isSha256(attachment.sha256),
              "attachment SHA-256 invalid"
            );

            invariant(
              !Object.prototype.hasOwnProperty.call(
                attachment,
                "content"
              ),
              "attachment binary content leaked into normalized structure"
            );

            return {
              index: attachment.index,
              filename:
                attachment.filename ?? null,
              mimeType:
                attachment.mimeType ?? null,
              disposition:
                attachment.disposition ?? null,
              related:
                attachment.related === true,
              contentId:
                attachment.contentId ?? null,
              description:
                attachment.description ?? null,
              sizeBytes:
                attachment.sizeBytes,
              sha256:
                attachment.sha256,
              contentStored: false,
            };
          }
        )
      : [];

  invariant(
    normalized.attachmentCount ===
      attachments.length,
    "attachment count mismatch"
  );

  const fingerprint = [
    "WALLTECH_MAIL_EVIDENCE_V1",
    acquisition.provider,
    acquisition.accountKey,
    String(
      acquisition.mailboxUser
    ).toLowerCase(),
    acquisition.mailboxPath,
    acquisition.uidValidity,
    String(acquisition.uid),
    acquisition.sourceSha256,
  ].join("\n");

  const evidenceId =
    `ME-${sha256Text(fingerprint)}`;

  return {
    evidenceVersion: "1.0",
    evidenceType: "MAIL_EVIDENCE",
    evidenceId,

    source: {
      sourceType:
        acquisition.sourceType,
      provider:
        acquisition.provider,
      accountKey:
        acquisition.accountKey,
      mailboxUser:
        acquisition.mailboxUser,
      mailboxPath:
        acquisition.mailboxPath,
      accessMode:
        acquisition.accessMode,
      selectorType:
        acquisition.selectorType,
      uidValidity:
        acquisition.uidValidity,
      uid:
        acquisition.uid,
    },

    identity: {
      messageId:
        acquisition.messageId ?? null,
      date:
        acquisition.date ?? null,
      internalDate:
        acquisition.internalDate ?? null,
      subject:
        acquisition.subject ?? null,
    },

    participants: {
      from:
        Array.isArray(acquisition.from)
          ? acquisition.from
          : [],
      to:
        Array.isArray(acquisition.to)
          ? acquisition.to
          : [],
      cc:
        Array.isArray(acquisition.cc)
          ? acquisition.cc
          : [],
      replyTo:
        Array.isArray(
          acquisition.replyTo
        )
          ? acquisition.replyTo
          : [],
    },

    rawEvidence: {
      sourceBytes:
        acquisition.sourceBytes,
      sourceSha256:
        acquisition.sourceSha256,
    },

    normalizedContent: {
      textPresent:
        normalized.content.textPresent,
      htmlPresent:
        normalized.content.htmlPresent,

      textCharacters:
        normalized.content.textCharacters,
      htmlCharacters:
        normalized.content.htmlCharacters,

      textBytes:
        normalized.content.textBytes,
      htmlBytes:
        normalized.content.htmlBytes,

      textSha256:
        normalized.content.textSha256,
      htmlSha256:
        normalized.content.htmlSha256,
    },

    attachmentCount:
      attachments.length,

    attachments,

    acquisitionEvidence: {
      acquisitionVersion:
        acquisition.acquisitionVersion,
      flagsBefore:
        acquisition.flagsBefore || [],
      flagsAfter:
        acquisition.flagsAfter || [],
      flagsUnchanged:
        acquisition.flagsUnchanged,
      acquiredAt:
        acquisition.acquiredAt,
    },

    normalizationEvidence: {
      normalizationVersion:
        normalized.normalizationVersion,
      normalizationType:
        normalized.normalizationType,
      normalizedAt:
        normalized.normalizedAt,
    },

    createdAt:
      new Date().toISOString(),
  };
}

function validateEvidence(evidence) {
  const schema = loadJson(
    DEFAULT_SCHEMA_PATH,
    "MAIL EVIDENCE SCHEMA"
  );

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  addFormats(ajv);

  let validate;

  try {
    validate = ajv.compile(schema);
  } catch (error) {
    fail(
      `MAIL EVIDENCE SCHEMA COMPILE ERROR:\n${error.message}`,
      4
    );
  }

  const valid = validate(evidence);

  if (!valid) {
    console.error(
      "MAIL EVIDENCE: INVALID"
    );
    console.error(
      JSON.stringify(
        validate.errors,
        null,
        2
      )
    );
    process.exit(4);
  }
}

function main() {
  const acquisitionPath =
    process.argv[2];

  const normalizedPath =
    process.argv[3];

  const outputPath =
    process.argv[4] || null;

  if (!acquisitionPath ||
      !normalizedPath) {
    console.error(
      "Usage: node src/mail/build-mail-evidence.js <acquisition.json> <normalized.json> [mail-evidence.json]"
    );
    process.exit(2);
  }

  const acquisition = loadJson(
    acquisitionPath,
    "ACQUISITION"
  );

  const normalized = loadJson(
    normalizedPath,
    "NORMALIZED MESSAGE"
  );

  const evidence = buildEvidence(
    acquisition,
    normalized
  );

  validateEvidence(evidence);

  const json =
    JSON.stringify(
      evidence,
      null,
      2
    ) + "\n";

  if (outputPath) {
    const absoluteOutput =
      path.resolve(
        process.cwd(),
        outputPath
      );

    fs.mkdirSync(
      path.dirname(absoluteOutput),
      {
        recursive: true,
      }
    );

    fs.writeFileSync(
      absoluteOutput,
      json
    );
  } else {
    process.stdout.write(json);
  }

  console.error("");
  console.error(
    "MAIL EVIDENCE BUILD: PASS"
  );
  console.error(
    `EVIDENCE ID: ${evidence.evidenceId}`
  );
  console.error(
    `MAILBOX: ${evidence.source.mailboxPath}`
  );
  console.error(
    `UIDVALIDITY: ${evidence.source.uidValidity}`
  );
  console.error(
    `UID: ${evidence.source.uid}`
  );
  console.error(
    `RAW SHA256: ${evidence.rawEvidence.sourceSha256}`
  );
  console.error(
    `ATTACHMENTS: ${evidence.attachmentCount}`
  );
}

main();
