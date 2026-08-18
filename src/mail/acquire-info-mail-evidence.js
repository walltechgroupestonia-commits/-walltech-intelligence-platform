const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ACCOUNT_KEY = "INFO";

const COMPONENTS = {
  acquire:
    "src/mail/read-aruba-message.js",
  normalize:
    "src/mail/normalize-rfc822-message.js",
  build:
    "src/mail/build-mail-evidence.js",
  validate:
    "src/mail/validate-mail-evidence.js",
};

function fail(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
}

function requireMailboxPath(value) {
  const mailboxPath =
    String(value || "").trim();

  if (!mailboxPath) {
    fail("MAILBOX PATH REQUIRED", 2);
  }

  return mailboxPath;
}

function requirePositiveUid(value) {
  const uid = Number(value);

  if (
    !Number.isInteger(uid) ||
    uid <= 0
  ) {
    fail(`INVALID UID: ${value}`, 2);
  }

  return uid;
}

function runNode(
  script,
  args,
  label
) {
  const result = spawnSync(
    process.execPath,
    [
      script,
      ...args,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      maxBuffer:
        32 * 1024 * 1024,
    }
  );

  if (result.error) {
    fail(
      `${label} FAILED TO START:\n${result.error.message}`,
      3
    );
  }

  if (result.status !== 0) {
    const diagnostic = [
      `${label} FAILED`,
      `EXIT CODE: ${result.status}`,
      "",
      "STDOUT:",
      result.stdout || "(empty)",
      "",
      "STDERR:",
      result.stderr || "(empty)",
    ].join("\n");

    fail(diagnostic, 3);
  }

  return result;
}

function loadJson(
  filePath,
  label
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch (error) {
    fail(
      `${label} INVALID JSON:\n${error.message}`,
      4
    );
  }
}

function verifyEvidence(
  evidence,
  mailboxPath,
  uid
) {
  if (
    evidence.evidenceType !==
    "MAIL_EVIDENCE"
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: evidenceType mismatch",
      5
    );
  }

  if (
    evidence.source.accountKey !==
    ACCOUNT_KEY
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: accountKey mismatch",
      5
    );
  }

  if (
    evidence.source.accessMode !==
    "READ_ONLY"
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: evidence is not READ_ONLY",
      5
    );
  }

  if (
    evidence.source.selectorType !==
    "UID"
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: selectorType is not UID",
      5
    );
  }

  if (
    evidence.source.mailboxPath !==
    mailboxPath
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: mailbox mismatch",
      5
    );
  }

  if (
    evidence.source.uid !== uid
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: UID mismatch",
      5
    );
  }

  if (
    typeof evidence.source.uidValidity !==
      "string" ||
    !/^[0-9]+$/.test(
      evidence.source.uidValidity
    )
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: UIDVALIDITY missing or invalid",
      5
    );
  }

  if (
    typeof evidence.rawEvidence
      ?.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(
      evidence.rawEvidence.sourceSha256
    )
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: raw SHA-256 invalid",
      5
    );
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        evidence.normalizedContent,
        "text"
      ) ||
    Object.prototype
      .hasOwnProperty.call(
        evidence.normalizedContent,
        "html"
      )
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: message body leaked into MailEvidence",
      5
    );
  }

  if (
    evidence.attachmentCount !==
    evidence.attachments.length
  ) {
    fail(
      "ORCHESTRATOR CONTRACT ERROR: attachment count mismatch",
      5
    );
  }

  for (
    const attachment of
    evidence.attachments
  ) {
    if (
      Object.prototype
        .hasOwnProperty.call(
          attachment,
          "content"
        )
    ) {
      fail(
        "ORCHESTRATOR CONTRACT ERROR: attachment binary leaked into MailEvidence",
        5
      );
    }

    if (
      attachment.contentStored !==
      false
    ) {
      fail(
        "ORCHESTRATOR CONTRACT ERROR: attachment storage contract violated",
        5
      );
    }
  }

  return true;
}

function acquireMailEvidence({
  mailboxPath,
  uid,
  outputPath,
}) {
  const tempDir =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "walltech-mail-evidence-"
      )
    );

  const rawPath =
    path.join(
      tempDir,
      "message.eml"
    );

  const acquisitionPath =
    path.join(
      tempDir,
      "acquisition.json"
    );

  const normalizedPath =
    path.join(
      tempDir,
      "normalized.json"
    );

  const evidencePath =
    path.join(
      tempDir,
      "mail-evidence.json"
    );

  let evidence;

  try {
    const acquisitionResult =
      runNode(
        COMPONENTS.acquire,
        [
          ACCOUNT_KEY,
          mailboxPath,
          String(uid),
          rawPath,
        ],
        "EXACT MESSAGE ACQUISITION"
      );

    fs.writeFileSync(
      acquisitionPath,
      acquisitionResult.stdout
    );

    const acquisition =
      loadJson(
        acquisitionPath,
        "ACQUISITION"
      );

    if (
      acquisition.accountKey !==
      ACCOUNT_KEY
    ) {
      fail(
        "ACQUISITION ACCOUNT IS NOT INFO",
        5
      );
    }

    if (
      acquisition.mailboxPath !==
      mailboxPath
    ) {
      fail(
        "ACQUISITION MAILBOX MISMATCH",
        5
      );
    }

    if (
      acquisition.uid !== uid
    ) {
      fail(
        "ACQUISITION UID MISMATCH",
        5
      );
    }

    if (
      acquisition.accessMode !==
        "READ_ONLY" ||
      acquisition.mailboxReadOnly !==
        true
    ) {
      fail(
        "ACQUISITION IS NOT VERIFIED READ_ONLY",
        5
      );
    }

    runNode(
      COMPONENTS.normalize,
      [
        rawPath,
        normalizedPath,
      ],
      "RFC822 NORMALIZATION"
    );

    runNode(
      COMPONENTS.build,
      [
        acquisitionPath,
        normalizedPath,
        evidencePath,
      ],
      "MAILEVIDENCE BUILD"
    );

    const validationResult =
      runNode(
        COMPONENTS.validate,
        [
          evidencePath,
        ],
        "MAILEVIDENCE VALIDATION"
      );

    if (
      !validationResult.stdout.includes(
        "MAIL EVIDENCE: VALID"
      )
    ) {
      fail(
        "MAILEVIDENCE VALIDATOR DID NOT RETURN VALID",
        5
      );
    }

    evidence =
      loadJson(
        evidencePath,
        "MAIL EVIDENCE"
      );

    verifyEvidence(
      evidence,
      mailboxPath,
      uid
    );

    if (outputPath) {
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
          evidence,
          null,
          2
        ) + "\n"
      );
    }
  } finally {
    fs.rmSync(
      tempDir,
      {
        recursive: true,
        force: true,
      }
    );
  }

  if (fs.existsSync(tempDir)) {
    fail(
      `TEMPORARY EVIDENCE CLEANUP FAILED: ${tempDir}`,
      6
    );
  }

  return evidence;
}

function main() {
  const mailboxPath =
    requireMailboxPath(
      process.argv[2]
    );

  const uid =
    requirePositiveUid(
      process.argv[3]
    );

  const outputPath =
    process.argv[4] || null;

  const evidence =
    acquireMailEvidence({
      mailboxPath,
      uid,
      outputPath,
    });

  if (!outputPath) {
    process.stdout.write(
      JSON.stringify(
        evidence,
        null,
        2
      ) + "\n"
    );
  }

  console.error("");
  console.error(
    "INFO MAILEVIDENCE ORCHESTRATION: PASS"
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
    `EVIDENCE ID: ${evidence.evidenceId}`
  );
  console.error(
    `RAW SHA256: ${evidence.rawEvidence.sourceSha256}`
  );
  console.error(
    `ATTACHMENTS: ${evidence.attachmentCount}`
  );
  console.error(
    "ACCESS MODE: READ_ONLY"
  );
  console.error(
    "TEMP CLEANUP: PASS"
  );
}

try {
  main();
} catch (error) {
  console.error("");
  console.error(
    "INFO MAILEVIDENCE ORCHESTRATION: FAILED"
  );
  console.error(
    error?.message || error
  );

  process.exitCode =
    Number.isInteger(
      error?.exitCode
    )
      ? error.exitCode
      : 1;
}
