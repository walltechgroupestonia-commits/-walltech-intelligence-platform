const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats =
  addFormatsModule.default || addFormatsModule;

const MAIL_EVIDENCE_SCHEMA =
  "src/mail/mail-evidence.schema.json";

const RESPONSE_EXPECTATION_SCHEMA =
  "src/mail/response-expectation-evidence.schema.json";

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function loadJson(filePath, label) {
  const absolute =
    path.resolve(process.cwd(), filePath);

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

function normalizedText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectHeaderBlock(lines, index) {
  if (
    !/^\s*from\s*:/i.test(
      lines[index] || ""
    )
  ) {
    return false;
  }

  const window =
    lines
      .slice(
        index,
        index + 7
      )
      .map(
        (line) =>
          line.trim()
      );

  const headerMatches =
    window.filter(
      (line) =>
        /^(?:sent|date|to|cc|subject)\s*:/i.test(
          line
        )
    ).length;

  return headerMatches >= 2;
}

function extractAuthoredText(text) {
  const lines =
    String(text || "")
      .split("\n");

  let boundaryIndex =
    lines.length;

  let quoteBoundaryType =
    "NONE";

  for (
    let index = 0;
    index < lines.length;
    index++
  ) {
    const line =
      lines[index];

    const trimmed =
      line.trim();

    if (
      /^\s*>+/.test(line)
    ) {
      boundaryIndex =
        index;

      quoteBoundaryType =
        "PREFIXED_QUOTE";

      break;
    }

    if (
      /^-{2,}\s*original message\s*-{2,}$/i.test(
        trimmed
      )
    ) {
      boundaryIndex =
        index;

      quoteBoundaryType =
        "ORIGINAL_MESSAGE_SEPARATOR";

      break;
    }

    if (
      /^begin forwarded message\s*:?\s*$/i.test(
        trimmed
      )
    ) {
      boundaryIndex =
        index;

      quoteBoundaryType =
        "FORWARDED_MESSAGE";

      break;
    }

    if (
      /^on\s+.+\s+wrote\s*:\s*$/i.test(
        trimmed
      )
    ) {
      boundaryIndex =
        index;

      quoteBoundaryType =
        "ON_WROTE";

      break;
    }

    if (
      /^il giorno\s+.+\s+ha scritto\s*:\s*$/i.test(
        trimmed
      )
    ) {
      boundaryIndex =
        index;

      quoteBoundaryType =
        "ITALIAN_WROTE";

      break;
    }

    if (
      detectHeaderBlock(
        lines,
        index
      )
    ) {
      boundaryIndex =
        index;

      quoteBoundaryType =
        "HEADER_BLOCK";

      break;
    }
  }

  const authoredText =
    lines
      .slice(
        0,
        boundaryIndex
      )
      .join("\n")
      .trim();

  const quotedHistoryDetected =
    boundaryIndex <
    lines.length;

  return {
    authoredText,

    scopeType:
      "AUTHORED_TEXT_ONLY",

    extractionPolicy:
      "CONSERVATIVE_QUOTED_HISTORY_TRUNCATION",

    authoredTextSha256:
      sha256Text(
        authoredText
      ),

    authoredTextCharacters:
      authoredText.length,

    quotedHistoryDetected,

    quoteBoundaryType,

    quoteBoundaryLine:
      quotedHistoryDetected
        ? boundaryIndex + 1
        : null,
  };
}

function addressesFrom(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((entry) =>
      typeof entry?.address === "string"
        ? entry.address
            .trim()
            .toLowerCase()
        : null
    )
    .filter(Boolean);
}

function detectDirection(
  evidence
) {
  const own =
    String(
      evidence.source.mailboxUser
    ).toLowerCase();

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

  const all =
    new Set([
      ...from,
      ...recipients,
      ...addressesFrom(
        evidence.participants?.replyTo
      ),
    ]);

  all.delete(own);

  const externalCount =
    all.size;

  if (
    from.includes(own) &&
    externalCount > 0
  ) {
    return "OUTBOUND";
  }

  if (
    !from.includes(own) &&
    recipients.includes(own)
  ) {
    return "INBOUND";
  }

  if (
    from.includes(own) &&
    externalCount === 0
  ) {
    return "SELF";
  }

  return "AMBIGUOUS";
}

/*
 * Conservative rule set.
 *
 * A match must contain explicit request/promise language.
 * Generic words such as "availability" or a question mark alone
 * are deliberately insufficient.
 */
const RULES = [
  {
    ruleId:
      "REE_RULE_PLEASE_CONFIRM",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\bplease\s+confirm\b/giu,
  },
  {
    ruleId:
      "REE_RULE_KINDLY_CONFIRM",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\bkindly\s+confirm\b/giu,
  },
  {
    ruleId:
      "REE_RULE_CAN_YOU_CONFIRM",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:can|could|would)\s+you\s+(?:please\s+)?confirm\b/giu,
  },
  {
    ruleId:
      "REE_RULE_PLEASE_ADVISE",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:please|kindly)\s+advise\b/giu,
  },
  {
    ruleId:
      "REE_RULE_PLEASE_PROVIDE",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:please|kindly)\s+provide\b/giu,
  },
  {
    ruleId:
      "REE_RULE_CAN_YOU_PROVIDE",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:can|could|would)\s+you\s+(?:please\s+)?provide\b/giu,
  },
  {
    ruleId:
      "REE_RULE_PLEASE_SEND",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:please|kindly)\s+send\b/giu,
  },
  {
    ruleId:
      "REE_RULE_CAN_YOU_SEND",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:can|could|would)\s+you\s+(?:please\s+)?send\b/giu,
  },
  {
    ruleId:
      "REE_RULE_LET_US_KNOW",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:please\s+|kindly\s+)?let\s+(?:us|me)\s+know\b/giu,
  },
  {
    ruleId:
      "REE_RULE_CAN_YOU_LET_US_KNOW",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:can|could|would)\s+you\s+(?:please\s+)?let\s+(?:us|me)\s+know\b/giu,
  },
  {
    ruleId:
      "REE_RULE_AWAITING_YOUR",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:we\s+are\s+)?awaiting\s+your\s+(?:reply|response|feedback|confirmation|quotation|quote|availability)\b/giu,
  },
  {
    ruleId:
      "REE_RULE_WAITING_FOR_YOUR",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\bwaiting\s+for\s+your\s+(?:reply|response|feedback|confirmation|quotation|quote|availability)\b/giu,
  },
  {
    ruleId:
      "REE_RULE_LOOKING_FORWARD_TO_YOUR",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\blooking\s+forward\s+to\s+your\s+(?:reply|response|feedback|confirmation|quotation|quote)\b/giu,
  },
  {
    ruleId:
      "REE_RULE_NEED_YOUR",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:we\s+)?need\s+your\s+(?:reply|response|feedback|confirmation|quotation|quote|availability)\b/giu,
  },
  {
    ruleId:
      "REE_RULE_PLEASE_REVERT",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:please|kindly)\s+revert\b/giu,
  },
  {
    ruleId:
      "REE_RULE_PLEASE_SHARE",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:please|kindly)\s+share\b/giu,
  },
  {
    ruleId:
      "REE_RULE_CAN_YOU_SHARE",
    signalType:
      "EXPLICIT_REQUEST",
    regex:
      /\b(?:can|could|would)\s+you\s+(?:please\s+)?share\b/giu,
  },
  {
    ruleId:
      "REE_RULE_WILL_CONFIRM",
    signalType:
      "EXPLICIT_PROMISE",
    regex:
      /\b(?:i|we)\s+(?:will|'ll)\s+confirm\b/giu,
  },
  {
    ruleId:
      "REE_RULE_WILL_REVERT",
    signalType:
      "EXPLICIT_PROMISE",
    regex:
      /\b(?:i|we)\s+(?:will|'ll)\s+revert\b/giu,
  },
  {
    ruleId:
      "REE_RULE_WILL_GET_BACK",
    signalType:
      "EXPLICIT_PROMISE",
    regex:
      /\b(?:i|we)\s+(?:will|'ll)\s+get\s+back\b/giu,
  },
  {
    ruleId:
      "REE_RULE_WILL_SEND",
    signalType:
      "EXPLICIT_PROMISE",
    regex:
      /\b(?:i|we)\s+(?:will|'ll)\s+send\b/giu,
  },
  {
    ruleId:
      "REE_RULE_WILL_PROVIDE",
    signalType:
      "EXPLICIT_PROMISE",
    regex:
      /\b(?:i|we)\s+(?:will|'ll)\s+provide\b/giu,
  },
  {
    ruleId:
      "REE_RULE_WILL_CHECK",
    signalType:
      "EXPLICIT_PROMISE",
    regex:
      /\b(?:i|we)\s+(?:will|'ll)\s+check\b/giu,
  },
  {
    ruleId:
      "REE_RULE_WILL_UPDATE",
    signalType:
      "EXPLICIT_PROMISE",
    regex:
      /\b(?:i|we)\s+(?:will|'ll)\s+update\s+you\b/giu,
  },
  {
    ruleId:
      "REE_RULE_WILL_LET_YOU_KNOW",
    signalType:
      "EXPLICIT_PROMISE",
    regex:
      /\b(?:i|we)\s+(?:will|'ll)\s+let\s+you\s+know\b/giu,
  },
];

function expectedResponder(
  direction,
  signalType
) {
  if (
    direction === "OUTBOUND" &&
    signalType === "EXPLICIT_REQUEST"
  ) {
    return "COUNTERPARTY";
  }

  if (
    direction === "INBOUND" &&
    signalType === "EXPLICIT_REQUEST"
  ) {
    return "WALLTECH";
  }

  if (
    direction === "INBOUND" &&
    signalType === "EXPLICIT_PROMISE"
  ) {
    return "COUNTERPARTY";
  }

  if (
    direction === "OUTBOUND" &&
    signalType === "EXPLICIT_PROMISE"
  ) {
    return "WALLTECH";
  }

  return "UNKNOWN";
}

function excerptAround(
  text,
  start,
  end
) {
  const radius = 110;

  const left =
    Math.max(
      0,
      start - radius
    );

  const right =
    Math.min(
      text.length,
      end + radius
    );

  let excerpt =
    text
      .slice(left, right)
      .replace(/\s+/g, " ")
      .trim();

  if (left > 0) {
    excerpt = `…${excerpt}`;
  }

  if (right < text.length) {
    excerpt = `${excerpt}…`;
  }

  if (excerpt.length > 320) {
    excerpt =
      excerpt.slice(0, 319) +
      "…";
  }

  return excerpt;
}

function scanSignals(
  text,
  direction
) {
  const signals = [];

  for (const rule of RULES) {
    rule.regex.lastIndex = 0;

    let match;

    while (
      (
        match =
          rule.regex.exec(text)
      ) !== null
    ) {
      const phrase =
        match[0];

      const excerpt =
        excerptAround(
          text,
          match.index,
          match.index +
            phrase.length
        );

      signals.push({
        ruleId:
          rule.ruleId,

        signalType:
          rule.signalType,

        expectedResponder:
          expectedResponder(
            direction,
            rule.signalType
          ),

        matchedPhrase:
          phrase,

        evidenceExcerpt:
          excerpt,

        excerptSha256:
          sha256Text(excerpt),
      });

      /*
       * Protect against pathological
       * zero-length regex matches.
       */
      if (
        match.index ===
        rule.regex.lastIndex
      ) {
        rule.regex.lastIndex++;
      }
    }
  }

  const unique =
    new Map();

  for (const signal of signals) {
    const key = [
      signal.ruleId,
      signal.expectedResponder,
      signal.excerptSha256,
    ].join(":");

    if (!unique.has(key)) {
      unique.set(
        key,
        signal
      );
    }
  }

  return [...unique.values()]
    .sort((a, b) => {
      const byRule =
        a.ruleId.localeCompare(
          b.ruleId
        );

      if (byRule !== 0) {
        return byRule;
      }

      return a.excerptSha256
        .localeCompare(
          b.excerptSha256
        );
    });
}

function main() {
  const evidencePath =
    process.argv[2];

  const normalizedPath =
    process.argv[3];

  const outputPath =
    process.argv[4] || null;

  if (
    !evidencePath ||
    !normalizedPath
  ) {
    console.error(
      "Usage: node src/mail/detect-response-expectation-evidence.js <mail-evidence.json> <normalized.json> [response-expectation.json]"
    );

    process.exit(2);
  }

  const mailEvidence =
    loadJson(
      evidencePath,
      "MAIL EVIDENCE"
    );

  const normalized =
    loadJson(
      normalizedPath,
      "NORMALIZED MESSAGE"
    );

  const validateMailEvidence =
    compileSchema(
      MAIL_EVIDENCE_SCHEMA
    );

  validateOrFail(
    validateMailEvidence,
    mailEvidence,
    "MAIL EVIDENCE",
    3
  );

  const validateResponseExpectation =
    compileSchema(
      RESPONSE_EXPECTATION_SCHEMA
    );

  const rawSha256Match =
    mailEvidence.rawEvidence
      .sourceSha256 ===
    normalized.rawEvidence
      ?.sourceSha256;

  const textSha256Match =
    mailEvidence.normalizedContent
      .textSha256 ===
    normalized.content
      ?.textSha256;

  const htmlSha256Match =
    mailEvidence.normalizedContent
      .htmlSha256 ===
    normalized.content
      ?.htmlSha256;

  const messageIdMatch =
    mailEvidence.identity
      .messageId ===
    normalized.identity
      ?.messageId;

  const subjectMatch =
    mailEvidence.identity
      .subject ===
    normalized.identity
      ?.subject;

  const verified =
    rawSha256Match &&
    textSha256Match &&
    htmlSha256Match &&
    messageIdMatch &&
    subjectMatch;

  if (!verified) {
    fail(
      "RESPONSE EXPECTATION CONTENT LINK ERROR: normalized content does not match MailEvidence",
      4
    );
  }

  const direction =
    detectDirection(
      mailEvidence
    );

  const text =
    normalizedText(
      normalized.content?.text
    );

  const contentScope =
    extractAuthoredText(
      text
    );

  const signals =
    scanSignals(
      contentScope.authoredText,
      direction
    );

  const responderSet =
    new Set(
      signals
        .map(
          (signal) =>
            signal.expectedResponder
        )
        .filter(
          (value) =>
            value !== "UNKNOWN"
        )
    );

  let determination;
  let responder;
  let basis;

  if (signals.length === 0) {
    determination =
      "NOT_ESTABLISHED";

    responder =
      "NONE";

    basis =
      "NO_EXPLICIT_RESPONSE_EXPECTATION_SIGNAL";
  } else if (
    responderSet.size === 1
  ) {
    determination =
      "EXPECTED";

    responder =
      [...responderSet][0];

    basis =
      "EXPLICIT_RESPONSE_EXPECTATION_SIGNAL";
  } else {
    determination =
      "AMBIGUOUS";

    responder =
      "UNKNOWN";

    basis =
      "CONFLICTING_RESPONSE_EXPECTATION_SIGNALS";
  }

  const signalFingerprint =
    signals
      .map(
        (signal) => [
          signal.ruleId,
          signal.signalType,
          signal.expectedResponder,
          signal.excerptSha256,
        ].join(":")
      )
      .join("\n");

  const fingerprint = [
    "WALLTECH_RESPONSE_EXPECTATION_EVIDENCE_V1",
    mailEvidence.evidenceId,
    mailEvidence.normalizedContent
      .textSha256 ||
      "NO_TEXT_SHA256",
    contentScope.authoredTextSha256,
    direction,
    determination,
    responder,
    signalFingerprint ||
      "NO_SIGNALS",
  ].join("\n");

  const result = {
    evidenceVersion: "1.0",

    evidenceType:
      "RESPONSE_EXPECTATION_EVIDENCE",

    responseExpectationEvidenceId:
      `REE-${sha256Text(
        fingerprint
      )}`,

    source: {
      mailEvidenceId:
        mailEvidence.evidenceId,

      accountKey:
        mailEvidence.source.accountKey,

      mailboxUser:
        mailEvidence.source.mailboxUser,

      mailboxPath:
        mailEvidence.source.mailboxPath,

      uidValidity:
        mailEvidence.source.uidValidity,

      uid:
        mailEvidence.source.uid,

      rawSourceSha256:
        mailEvidence.rawEvidence
          .sourceSha256,

      textSha256:
        mailEvidence.normalizedContent
          .textSha256,

      htmlSha256:
        mailEvidence.normalizedContent
          .htmlSha256,
    },

    message: {
      messageId:
        mailEvidence.identity
          .messageId,

      subject:
        mailEvidence.identity
          .subject,

      direction,
    },

    contentIntegrity: {
      rawSha256Match,
      textSha256Match,
      htmlSha256Match,
      messageIdMatch,
      subjectMatch,
      verified: true,
    },

    contentScope: {
      scopeType:
        contentScope.scopeType,

      extractionPolicy:
        contentScope.extractionPolicy,

      authoredTextSha256:
        contentScope.authoredTextSha256,

      authoredTextCharacters:
        contentScope.authoredTextCharacters,

      quotedHistoryDetected:
        contentScope.quotedHistoryDetected,

      quoteBoundaryType:
        contentScope.quoteBoundaryType,

      quoteBoundaryLine:
        contentScope.quoteBoundaryLine,
    },

    explicitSignalCount:
      signals.length,

    signals,

    determination,

    expectedResponder:
      responder,

    basis,

    commercialStateInference:
      "NONE",

    generatedAt:
      new Date().toISOString(),
  };

  validateOrFail(
    validateResponseExpectation,
    result,
    "RESPONSE EXPECTATION EVIDENCE",
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
    "RESPONSE EXPECTATION EVIDENCE: PASS"
  );

  console.error(
    `MAIL EVIDENCE: ${result.source.mailEvidenceId}`
  );

  console.error(
    `DIRECTION: ${result.message.direction}`
  );

  console.error(
    `CONTENT SCOPE: ${result.contentScope.scopeType}`
  );

  console.error(
    `QUOTED HISTORY: ${result.contentScope.quotedHistoryDetected}`
  );

  console.error(
    `QUOTE BOUNDARY: ${result.contentScope.quoteBoundaryType}`
  );

  console.error(
    `SIGNALS: ${result.explicitSignalCount}`
  );

  console.error(
    `DETERMINATION: ${result.determination}`
  );

  console.error(
    `EXPECTED RESPONDER: ${result.expectedResponder}`
  );

  for (
    const signal of
    result.signals
  ) {
    console.error(
      `${signal.ruleId} | ` +
      `${signal.signalType} | ` +
      `${signal.expectedResponder} | ` +
      `"${signal.matchedPhrase}"`
    );
  }
}

main();
