const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 =
  Ajv2020Module.default || Ajv2020Module;

const addFormatsModule =
  require("ajv-formats");
const addFormats =
  addFormatsModule.default || addFormatsModule;

const MAIL_EVIDENCE_SCHEMA =
  "src/mail/mail-evidence.schema.json";

const RESPONSE_EXPECTATION_SCHEMA =
  "src/mail/response-expectation-evidence.schema.json";

const CCI_SCHEMA =
  "src/mail/commercial-communication-interpretation.schema.json";

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function loadJson(filePath, label) {
  const absolute =
    path.resolve(process.cwd(), filePath);

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

function compileSchema(schemaPath) {
  const schema =
    loadJson(schemaPath, "SCHEMA");

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
    .update(String(value), "utf8")
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

function canonicalSku(value) {
  return String(value || "")
    .replace(/[\u2010-\u2015]/gu, "-")
    .toUpperCase();
}

function extractSkus(text) {
  const skuRegex =
    /\b[A-Z]{2,}[A-Z0-9]*[-\u2010-\u2015][A-Z0-9]+(?:[-\u2010-\u2015][A-Z0-9]+)+\b/gu;

  const matches =
    String(text || "").match(skuRegex) || [];

  return [
    ...new Set(
      matches.map(canonicalSku)
    ),
  ];
}

function sentencesFrom(text) {
  return String(text || "")
    .replace(/\n+/gu, " ")
    .split(/(?<=[.!?])\s+/gu)
    .map((value) => value.trim())
    .filter(Boolean);
}

function authoredTextFrom(
  normalized,
  responseExpectation
) {
  const text =
    normalizedText(
      normalized.content?.text
    );

  const lines =
    text.split("\n");

  const boundary =
    responseExpectation
      .contentScope
      .quoteBoundaryLine;

  const authoredText =
    (
      boundary
        ? lines.slice(
            0,
            boundary - 1
          )
        : lines
    )
      .join("\n")
      .trim();

  const actualHash =
    sha256Text(authoredText);

  const expectedHash =
    responseExpectation
      .contentScope
      .authoredTextSha256;

  if (actualHash !== expectedHash) {
    fail(
      "CCI CONTENT LINK ERROR: authored text SHA256 mismatch",
      4
    );
  }

  return authoredText;
}

function addSignal(
  signals,
  {
    signalType,
    subject = null,
    semanticValue,
    certainty,
    evidenceExcerpt,
  }
) {
  const excerpt =
    String(evidenceExcerpt || "")
      .trim();

  if (!excerpt) {
    return;
  }

  const signal = {
    signalType,
    subject,
    semanticValue,
    certainty,
    evidenceExcerpt: excerpt,
    evidenceExcerptSha256:
      sha256Text(excerpt),
    basis:
      "AUTHORED_TEXT_EXPLICIT_STATEMENT",
  };

  const key = [
    signal.signalType,
    signal.subject || "NONE",
    signal.semanticValue,
    signal.evidenceExcerptSha256,
  ].join("|");

  if (
    !signals.some(
      (existing) =>
        [
          existing.signalType,
          existing.subject || "NONE",
          existing.semanticValue,
          existing.evidenceExcerptSha256,
        ].join("|") === key
    )
  ) {
    signals.push(signal);
  }
}

function addActionDirective(
  directives,
  {
    actor,
    action,
    target = null,
    evidenceExcerpt,
  }
) {
  const excerpt =
    String(evidenceExcerpt || "")
      .trim();

  if (!excerpt) {
    return;
  }

  const directive = {
    actor,
    action,
    target,
    evidenceExcerpt: excerpt,
    evidenceExcerptSha256:
      sha256Text(excerpt),
  };

  const key = [
    directive.actor,
    directive.action,
    directive.target || "NONE",
    directive.evidenceExcerptSha256,
  ].join("|");

  if (
    !directives.some(
      (existing) =>
        [
          existing.actor,
          existing.action,
          existing.target || "NONE",
          existing.evidenceExcerptSha256,
        ].join("|") === key
    )
  ) {
    directives.push(directive);
  }
}

function findSentence(
  sentences,
  regex
) {
  return (
    sentences.find(
      (sentence) =>
        regex.test(sentence)
    ) || null
  );
}

function buildInterpretation(
  mailEvidence,
  normalized,
  ree
) {
  if (
    ree.source.mailEvidenceId !==
    mailEvidence.evidenceId
  ) {
    fail(
      "CCI LINK ERROR: REE does not reference supplied MailEvidence",
      4
    );
  }

  if (
    ree.contentIntegrity?.verified !==
    true
  ) {
    fail(
      "CCI LINK ERROR: Response Expectation content integrity is not verified",
      4
    );
  }

  if (
    mailEvidence.rawEvidence
      .sourceSha256 !==
    normalized.rawEvidence
      ?.sourceSha256
  ) {
    fail(
      "CCI LINK ERROR: raw SHA256 mismatch",
      4
    );
  }

  if (
    mailEvidence.normalizedContent
      .textSha256 !==
    normalized.content
      ?.textSha256
  ) {
    fail(
      "CCI LINK ERROR: normalized text SHA256 mismatch",
      4
    );
  }

  if (
    mailEvidence.identity
      .messageId !==
    normalized.identity
      ?.messageId
  ) {
    fail(
      "CCI LINK ERROR: Message-ID mismatch",
      4
    );
  }

  if (
    mailEvidence.identity
      .subject !==
    normalized.identity
      ?.subject
  ) {
    fail(
      "CCI LINK ERROR: subject mismatch",
      4
    );
  }

  const authoredText =
    authoredTextFrom(
      normalized,
      ree
    );

  const sentences =
    sentencesFrom(authoredText);

  const signals = [];
  const actionDirectives = [];

  /*
   * Identify explicitly proposed alternative SKU first.
   */
  let alternativeSku = null;

  for (const sentence of sentences) {
    if (
      /best option.+(?:price|lead time).+\bis\b/iu
        .test(sentence)
    ) {
      const skus =
        extractSkus(sentence);

      if (skus.length > 0) {
        alternativeSku =
          skus[skus.length - 1];

        addSignal(
          signals,
          {
            signalType:
              "PRODUCT_ALTERNATIVE",
            subject:
              alternativeSku,
            semanticValue:
              "RECOMMENDED_REPLACEMENT",
            certainty:
              "EXPLICIT",
            evidenceExcerpt:
              sentence,
          }
        );

        addSignal(
          signals,
          {
            signalType:
              "COMMERCIAL_RECOMMENDATION",
            subject:
              alternativeSku,
            semanticValue:
              "BEST_OPTION_FOR_PRICE_AND_LEAD_TIME",
            certainty:
              "EXPLICIT",
            evidenceExcerpt:
              sentence,
          }
        );
      }
    }
  }

  /*
   * Availability / allocation.
   */
  for (const sentence of sentences) {
    if (
      /\bcurrently under allocation\b/iu
        .test(sentence)
    ) {
      const skus =
        extractSkus(sentence);

      const subject =
        skus[0] || null;

      addSignal(
        signals,
        {
          signalType:
            "AVAILABILITY_STATUS",
          subject,
          semanticValue:
            "UNDER_ALLOCATION",
          certainty:
            "EXPLICIT",
          evidenceExcerpt:
            sentence,
        }
      );

      if (
        /\bcritical\b.+\bshortage\b/iu
          .test(sentence)
      ) {
        addSignal(
          signals,
          {
            signalType:
              "SUPPLIER_CONSTRAINT",
            subject,
            semanticValue:
              "CRITICAL_MEMORY_SHORTAGE",
            certainty:
              "EXPLICIT",
            evidenceExcerpt:
              sentence,
          }
        );
      }
    }
  }

  /*
   * Lead-time impossibility / uncertainty.
   */
  for (const sentence of sentences) {
    if (
      /\bcannot confirm any specific lead time\b/iu
        .test(sentence)
    ) {
      const skus =
        extractSkus(sentence);

      addSignal(
        signals,
        {
          signalType:
            "LEAD_TIME_STATUS",
          subject:
            skus[0] || null,
          semanticValue:
            "SPECIFIC_LEAD_TIME_NOT_CONFIRMABLE",
          certainty:
            "EXPLICIT",
          evidenceExcerpt:
            sentence,
        }
      );
    }

    if (
      /\blead time may be more than 1 year\b/iu
        .test(sentence)
    ) {
      addSignal(
        signals,
        {
          signalType:
            "LEAD_TIME_STATUS",
          subject: null,
          semanticValue:
            "LEAD_TIME_MAY_EXCEED_ONE_YEAR",
          certainty:
            "QUALIFIED",
          evidenceExcerpt:
            sentence,
        }
      );
    }
  }

  /*
   * Explicit directive addressed to Walltech.
   */
  for (const sentence of sentences) {
    if (
      /\bplease work with the customer on the replacement\b/iu
        .test(sentence)
    ) {
      addSignal(
        signals,
        {
          signalType:
            "ACTION_DIRECTIVE",
          subject:
            alternativeSku,
          semanticValue:
            "WORK_WITH_CUSTOMER_ON_REPLACEMENT",
          certainty:
            "EXPLICIT",
          evidenceExcerpt:
            sentence,
        }
      );

      addActionDirective(
        actionDirectives,
        {
          actor:
            "WALLTECH",
          action:
            "WORK_WITH_CUSTOMER_ON_REPLACEMENT",
          target:
            alternativeSku ||
            "REPLACEMENT",
          evidenceExcerpt:
            sentence,
        }
      );
    }
  }

  /*
   * Product reference classification.
   * Any explicitly recommended best-option SKU is ALTERNATIVE.
   * Other SKU references remain REQUESTED for v1.
   */
  const allSkus =
    extractSkus(authoredText);

  const productReferences =
    allSkus.map((sku) => {
      const role =
        sku === alternativeSku
          ? "ALTERNATIVE"
          : "REQUESTED";

      const evidenceSentence =
        sentences.find(
          (sentence) =>
            extractSkus(sentence)
              .includes(sku)
        ) || authoredText;

      return {
        productRef: sku,
        role,
        evidenceExcerpt:
          evidenceSentence,
        evidenceExcerptSha256:
          sha256Text(
            evidenceSentence
          ),
      };
    });

  const actorSet =
    new Set(
      actionDirectives
        .map((item) => item.actor)
        .filter(Boolean)
    );

  let nextActorDetermination =
    "NONE";

  if (actorSet.size === 1) {
    nextActorDetermination =
      [...actorSet][0];
  } else if (actorSet.size > 1) {
    nextActorDetermination =
      "UNKNOWN";
  }

  const blockerIdentified =
    signals.some(
      (signal) =>
        [
          "SUPPLIER_CONSTRAINT",
          "AVAILABILITY_STATUS",
          "LEAD_TIME_STATUS",
        ].includes(
          signal.signalType
        )
    );

  const alternativeIdentified =
    productReferences.some(
      (item) =>
        item.role ===
        "ALTERNATIVE"
    );

  const actionRequired =
    actionDirectives.length > 0;

  const impactCount =
    [
      blockerIdentified,
      alternativeIdentified,
      actionRequired,
    ].filter(Boolean).length;

  let dealImpact =
    "NO_EXPLICIT_IMPACT";

  if (impactCount > 1) {
    dealImpact = "MULTIPLE";
  } else if (blockerIdentified) {
    dealImpact =
      "BLOCKER_IDENTIFIED";
  } else if (alternativeIdentified) {
    dealImpact =
      "ALTERNATIVE_IDENTIFIED";
  } else if (actionRequired) {
    dealImpact =
      "ACTION_REQUIRED";
  }

  signals.sort(
    (a, b) =>
      [
        a.signalType,
        a.subject || "",
        a.semanticValue,
        a.evidenceExcerptSha256,
      ]
        .join("|")
        .localeCompare(
          [
            b.signalType,
            b.subject || "",
            b.semanticValue,
            b.evidenceExcerptSha256,
          ].join("|")
        )
  );

  productReferences.sort(
    (a, b) =>
      a.productRef.localeCompare(
        b.productRef
      )
  );

  actionDirectives.sort(
    (a, b) =>
      [
        a.actor,
        a.action,
        a.target || "",
      ]
        .join("|")
        .localeCompare(
          [
            b.actor,
            b.action,
            b.target || "",
          ].join("|")
        )
  );

  const fingerprint = [
    "WALLTECH_COMMERCIAL_COMMUNICATION_INTERPRETATION_V1",
    mailEvidence.evidenceId,
    ree.responseExpectationEvidenceId,
    ree.contentScope.authoredTextSha256,
    ree.message.direction,
    ...signals.map(
      (signal) =>
        [
          signal.signalType,
          signal.subject || "NONE",
          signal.semanticValue,
          signal.certainty,
          signal.evidenceExcerptSha256,
        ].join(":")
    ),
    ...productReferences.map(
      (item) =>
        [
          item.productRef,
          item.role,
          item.evidenceExcerptSha256,
        ].join(":")
    ),
    ...actionDirectives.map(
      (item) =>
        [
          item.actor,
          item.action,
          item.target || "NONE",
          item.evidenceExcerptSha256,
        ].join(":")
    ),
    nextActorDetermination,
    dealImpact,
    "NONE"
  ].join("\n");

  return {
    interpretationVersion:
      "1.0",

    interpretationType:
      "COMMERCIAL_COMMUNICATION_INTERPRETATION",

    commercialCommunicationInterpretationId:
      `CCI-${sha256Text(
        fingerprint
      )}`,

    interpretationPolicy:
      "EXPLICIT_AUTHORED_TEXT_ONLY_V1",

    source: {
      mailEvidenceId:
        mailEvidence.evidenceId,

      responseExpectationEvidenceId:
        ree.responseExpectationEvidenceId,

      accountKey:
        ree.source.accountKey,

      mailboxUser:
        ree.source.mailboxUser,

      mailboxPath:
        ree.source.mailboxPath,

      uidValidity:
        ree.source.uidValidity,

      uid:
        ree.source.uid,

      rawSourceSha256:
        ree.source.rawSourceSha256,

      textSha256:
        ree.source.textSha256,

      authoredTextSha256:
        ree.contentScope
          .authoredTextSha256,
    },

    message: {
      messageId:
        ree.message.messageId,

      subject:
        ree.message.subject,

      direction:
        ree.message.direction,
    },

    contentScope: {
      scopeType:
        ree.contentScope.scopeType,

      authoredTextCharacters:
        ree.contentScope
          .authoredTextCharacters,

      quotedHistoryDetected:
        ree.contentScope
          .quotedHistoryDetected,
    },

    signalCount:
      signals.length,

    signals,

    productReferenceCount:
      productReferences.length,

    productReferences,

    actionDirectiveCount:
      actionDirectives.length,

    actionDirectives,

    nextActorDetermination,

    dealImpact,

    commercialStateMutation:
      "NONE",

    generatedAt:
      new Date().toISOString(),
  };
}

function main() {
  const mailEvidencePath =
    process.argv[2];

  const normalizedPath =
    process.argv[3];

  const responseExpectationPath =
    process.argv[4];

  const outputPath =
    process.argv[5] || null;

  if (
    !mailEvidencePath ||
    !normalizedPath ||
    !responseExpectationPath
  ) {
    console.error(
      "Usage: node src/mail/detect-commercial-communication-interpretation.js <mail-evidence.json> <normalized.json> <response-expectation.json> [output.json]"
    );
    process.exit(2);
  }

  const mailEvidence =
    loadJson(
      mailEvidencePath,
      "MAIL EVIDENCE"
    );

  const normalized =
    loadJson(
      normalizedPath,
      "NORMALIZED MESSAGE"
    );

  const ree =
    loadJson(
      responseExpectationPath,
      "RESPONSE EXPECTATION EVIDENCE"
    );

  validateOrFail(
    compileSchema(
      MAIL_EVIDENCE_SCHEMA
    ),
    mailEvidence,
    "MAIL EVIDENCE",
    3
  );

  validateOrFail(
    compileSchema(
      RESPONSE_EXPECTATION_SCHEMA
    ),
    ree,
    "RESPONSE EXPECTATION EVIDENCE",
    3
  );

  const result =
    buildInterpretation(
      mailEvidence,
      normalized,
      ree
    );

  validateOrFail(
    compileSchema(CCI_SCHEMA),
    result,
    "COMMERCIAL COMMUNICATION INTERPRETATION",
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
    "COMMERCIAL COMMUNICATION INTERPRETATION: PASS"
  );

  console.error(
    `CCI: ${result.commercialCommunicationInterpretationId}`
  );

  console.error(
    `SIGNALS: ${result.signalCount}`
  );

  console.error(
    `PRODUCT REFERENCES: ${result.productReferenceCount}`
  );

  console.error(
    `ACTION DIRECTIVES: ${result.actionDirectiveCount}`
  );

  console.error(
    `NEXT ACTOR: ${result.nextActorDetermination}`
  );

  console.error(
    `DEAL IMPACT: ${result.dealImpact}`
  );

  console.error(
    `STATE MUTATION: ${result.commercialStateMutation}`
  );
}

main();
