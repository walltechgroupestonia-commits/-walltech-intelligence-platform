const fs = require("node:fs");
const path = require("node:path");

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

const SCHEMA_PATHS = {
  mailEvidence:
    "src/mail/mail-evidence.schema.json",

  detection:
    "src/mail/communication-cycle-detection.schema.json",

  reconciliation:
    "src/reporting/collaborator-reconciliation-input.schema.json",

  adapter:
    "src/reporting/collaborator-evidence-adapter-input.schema.json",
};

function loadJson(
  filePath,
  label,
) {
  const absolutePath =
    path.resolve(
      process.cwd(),
      filePath,
    );

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
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

function compileAdapterSchema() {
  const mailEvidenceSchema =
    loadJson(
      SCHEMA_PATHS.mailEvidence,
      "MAIL EVIDENCE SCHEMA",
    );

  const detectionSchema =
    loadJson(
      SCHEMA_PATHS.detection,
      "COMMUNICATION DETECTION SCHEMA",
    );

  const reconciliationSchema =
    loadJson(
      SCHEMA_PATHS.reconciliation,
      "RECONCILIATION INPUT SCHEMA",
    );

  const adapterSchema =
    loadJson(
      SCHEMA_PATHS.adapter,
      "COLLABORATOR EVIDENCE ADAPTER INPUT SCHEMA",
    );

  const ajv =
    new Ajv2020({
      allErrors: true,
      strict: true,
    });

  addFormats(ajv);

  ajv.addSchema(
    mailEvidenceSchema,
  );

  ajv.addSchema(
    detectionSchema,
  );

  ajv.addSchema(
    reconciliationSchema,
  );

  return ajv.compile(
    adapterSchema,
  );
}

function normalizeEmail(value) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  return normalized || null;
}

function normalizeString(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  return String(value);
}

function addressListEmails(list) {
  if (
    !Array.isArray(list)
  ) {
    return [];
  }

  return list
    .map(
      (entry) =>
        normalizeEmail(
          entry?.address,
        ),
    )
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [
    ...new Set(values),
  ].sort();
}

function externalAddressesFromEvidence(
  evidence,
) {
  const mailboxUser =
    normalizeEmail(
      evidence.source.mailboxUser,
    );

  const addresses = [
    ...addressListEmails(
      evidence.participants?.from,
    ),

    ...addressListEmails(
      evidence.participants?.to,
    ),

    ...addressListEmails(
      evidence.participants?.cc,
    ),

    ...addressListEmails(
      evidence.participants?.replyTo,
    ),
  ];

  return uniqueSorted(
    addresses.filter(
      (address) =>
        address !== mailboxUser,
    ),
  );
}

function detectDirection(
  evidence,
) {
  const own =
    normalizeEmail(
      evidence.source.mailboxUser,
    );

  const from =
    addressListEmails(
      evidence.participants?.from,
    );

  const recipients = [
    ...addressListEmails(
      evidence.participants?.to,
    ),

    ...addressListEmails(
      evidence.participants?.cc,
    ),
  ];

  const fromOwn =
    from.includes(own);

  const recipientOwn =
    recipients.includes(own);

  const external =
    externalAddressesFromEvidence(
      evidence,
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

function expectedMessageDate(
  evidence,
) {
  return (
    evidence.identity?.date ??
    evidence.identity?.internalDate ??
    null
  );
}

function buildCollaboratorDirectoryIndex(
  collaboratorDirectory,
) {
  const collaboratorIds =
    new Set();

  const emailToCollaborator =
    new Map();

  for (
    const collaborator
    of collaboratorDirectory
  ) {
    if (
      collaboratorIds.has(
        collaborator.collaboratorId,
      )
    ) {
      throw new Error(
        `DUPLICATE COLLABORATOR ID: ${collaborator.collaboratorId}`,
      );
    }

    collaboratorIds.add(
      collaborator.collaboratorId,
    );

    const localEmails =
      new Set();

    for (
      const rawEmail
      of collaborator.emailAddresses
    ) {
      const email =
        normalizeEmail(
          rawEmail,
        );

      if (!email) {
        throw new Error(
          `INVALID COLLABORATOR EMAIL: ${collaborator.collaboratorId}`,
        );
      }

      if (
        localEmails.has(email)
      ) {
        throw new Error(
          `DUPLICATE COLLABORATOR EMAIL WITHIN IDENTITY: ${collaborator.collaboratorId} / ${email}`,
        );
      }

      localEmails.add(email);

      if (
        emailToCollaborator.has(
          email,
        )
      ) {
        const previous =
          emailToCollaborator.get(
            email,
          );

        throw new Error(
          `COLLABORATOR EMAIL COLLISION: ${email} (${previous.collaboratorId}, ${collaborator.collaboratorId})`,
        );
      }

      emailToCollaborator.set(
        email,
        {
          collaboratorId:
            collaborator.collaboratorId,

          collaboratorName:
            collaborator.collaboratorName,
        },
      );
    }
  }

  return emailToCollaborator;
}

function resolveCollaborator(
  evidence,
  emailToCollaborator,
) {
  const direction =
    detectDirection(
      evidence,
    );

  const own =
    normalizeEmail(
      evidence.source.mailboxUser,
    );

  let candidateAddresses;

  /*
   * Identity attribution is directional.
   *
   * INBOUND:
   *   the operational collaborator is the sender.
   *   CC / To / Reply-To must not create false ambiguity.
   *
   * OUTBOUND:
   *   the operational collaborator is resolved from external
   *   recipients. Multiple known recipients remain ambiguous
   *   and fail closed because the current event contract
   *   permits exactly one collaborator per evidence item.
   */
  if (
    direction === "INBOUND"
  ) {
    candidateAddresses =
      uniqueSorted(
        addressListEmails(
          evidence.participants?.from,
        ).filter(
          address =>
            address !== own,
        ),
      );
  } else if (
    direction === "OUTBOUND"
  ) {
    candidateAddresses =
      uniqueSorted(
        [
          ...addressListEmails(
            evidence.participants?.to,
          ),

          ...addressListEmails(
            evidence.participants?.cc,
          ),
        ].filter(
          address =>
            address !== own,
        ),
      );
  } else if (
    direction === "SELF"
  ) {
    throw new Error(
      `COLLABORATOR UNRESOLVED FOR SELF EVIDENCE: ${evidence.evidenceId}`,
    );
  } else {
    throw new Error(
      `COLLABORATOR DIRECTION AMBIGUOUS FOR EVIDENCE: ${evidence.evidenceId}`,
    );
  }

  const matchedCollaborators =
    new Map();

  for (
    const address
    of candidateAddresses
  ) {
    const collaborator =
      emailToCollaborator.get(
        address,
      );

    if (!collaborator) {
      continue;
    }

    matchedCollaborators.set(
      collaborator.collaboratorId,
      collaborator,
    );
  }

  if (
    matchedCollaborators.size === 0
  ) {
    throw new Error(
      `COLLABORATOR UNRESOLVED FOR EVIDENCE: ${evidence.evidenceId}`,
    );
  }

  if (
    matchedCollaborators.size > 1
  ) {
    const ids =
      [
        ...matchedCollaborators.keys(),
      ].sort();

    throw new Error(
      `COLLABORATOR AMBIGUOUS FOR EVIDENCE: ${evidence.evidenceId} (${ids.join(", ")})`,
    );
  }

  return [
    ...matchedCollaborators.values(),
  ][0];
}

function semanticGuard(input) {
  const evidenceById =
    new Map();

  const evidenceBySourceSha256 =
    new Map();

  /*
   * Every MailEvidence in the current batch must be unique
   * both by its identity and by canonical source hash.
   *
   * Peer duplicates are rejected here instead of silently
   * picking one evidence record.
   */
  for (
    const evidence
    of input.mailEvidence
  ) {
    if (
      evidenceById.has(
        evidence.evidenceId,
      )
    ) {
      throw new Error(
        `DUPLICATE MAIL EVIDENCE ID: ${evidence.evidenceId}`,
      );
    }

    evidenceById.set(
      evidence.evidenceId,
      evidence,
    );

    const sourceSha256 =
      evidence.rawEvidence
        ?.sourceSha256;

    if (
      evidenceBySourceSha256.has(
        sourceSha256,
      )
    ) {
      const previous =
        evidenceBySourceSha256.get(
          sourceSha256,
        );

      throw new Error(
        `DUPLICATE MAIL SOURCE SHA256: ${sourceSha256} (${previous}, ${evidence.evidenceId})`,
      );
    }

    evidenceBySourceSha256.set(
      sourceSha256,
      evidence.evidenceId,
    );
  }

  const detection =
    input.communicationDetection;

  /*
   * Detection and MailEvidence must describe exactly
   * the same current evidence batch.
   */
  if (
    detection.messageCount !==
    input.mailEvidence.length
  ) {
    throw new Error(
      `DETECTION MESSAGE COUNT MISMATCH: expected ${input.mailEvidence.length}, got ${detection.messageCount}`,
    );
  }

  if (
    detection.source.evidenceCount !==
    input.mailEvidence.length
  ) {
    throw new Error(
      `DETECTION SOURCE EVIDENCE COUNT MISMATCH: expected ${input.mailEvidence.length}, got ${detection.source.evidenceCount}`,
    );
  }

  const firstEvidence =
    input.mailEvidence[0];

  const expectedSource = {
    accountKey:
      firstEvidence.source.accountKey,

    mailboxUser:
      normalizeEmail(
        firstEvidence.source.mailboxUser,
      ),

    provider:
      firstEvidence.source.provider,
  };

  if (
    detection.source.accountKey !==
    expectedSource.accountKey ||
    normalizeEmail(
      detection.source.mailboxUser,
    ) !==
      expectedSource.mailboxUser ||
    detection.source.provider !==
      expectedSource.provider
  ) {
    throw new Error(
      "DETECTION SOURCE DOES NOT MATCH MAIL EVIDENCE SOURCE",
    );
  }

  /*
   * The detector itself requires a common source.
   * Re-check it here so a forged mixed batch cannot
   * cross the reporting boundary.
   */
  for (
    const evidence
    of input.mailEvidence
  ) {
    if (
      evidence.source.accountKey !==
        expectedSource.accountKey ||
      normalizeEmail(
        evidence.source.mailboxUser,
      ) !==
        expectedSource.mailboxUser ||
      evidence.source.provider !==
        expectedSource.provider
    ) {
      throw new Error(
        `MAIL EVIDENCE SOURCE MISMATCH: ${evidence.evidenceId}`,
      );
    }
  }

  const detectionMessageByEvidenceId =
    new Map();

  for (
    const message
    of detection.messages
  ) {
    if (
      detectionMessageByEvidenceId.has(
        message.evidenceId,
      )
    ) {
      throw new Error(
        `DUPLICATE DETECTION EVIDENCE ID: ${message.evidenceId}`,
      );
    }

    const evidence =
      evidenceById.get(
        message.evidenceId,
      );

    if (!evidence) {
      throw new Error(
        `DETECTION REFERENCES UNKNOWN MAIL EVIDENCE: ${message.evidenceId}`,
      );
    }

    if (
      message.mailboxPath !==
        evidence.source.mailboxPath ||
      normalizeString(
        message.uidValidity,
      ) !==
        normalizeString(
          evidence.source.uidValidity,
        ) ||
      message.uid !==
        evidence.source.uid
    ) {
      throw new Error(
        `DETECTION IMAP COORDINATE MISMATCH: ${message.evidenceId}`,
      );
    }

    if (
      normalizeString(
        message.messageId,
      ) !==
      normalizeString(
        evidence.identity.messageId,
      )
    ) {
      throw new Error(
        `DETECTION MESSAGE ID MISMATCH: ${message.evidenceId}`,
      );
    }

    if (
      normalizeString(
        message.date,
      ) !==
      normalizeString(
        expectedMessageDate(
          evidence,
        ),
      )
    ) {
      throw new Error(
        `DETECTION DATE MISMATCH: ${message.evidenceId}`,
      );
    }

    const expectedDirection =
      detectDirection(
        evidence,
      );

    if (
      message.direction !==
      expectedDirection
    ) {
      throw new Error(
        `DETECTION DIRECTION MISMATCH: ${message.evidenceId}`,
      );
    }

    const expectedExternal =
      externalAddressesFromEvidence(
        evidence,
      );

    const actualExternal =
      uniqueSorted(
        message.externalAddresses.map(
          normalizeEmail,
        ),
      );

    if (
      JSON.stringify(
        actualExternal,
      ) !==
      JSON.stringify(
        expectedExternal,
      )
    ) {
      throw new Error(
        `DETECTION EXTERNAL ADDRESS MISMATCH: ${message.evidenceId}`,
      );
    }

    detectionMessageByEvidenceId.set(
      message.evidenceId,
      message,
    );
  }

  for (
    const evidenceId
    of evidenceById.keys()
  ) {
    if (
      !detectionMessageByEvidenceId.has(
        evidenceId,
      )
    ) {
      throw new Error(
        `MAIL EVIDENCE MISSING FROM DETECTION: ${evidenceId}`,
      );
    }
  }

  /*
   * Candidate relationships are threading evidence only.
   * They must be internally complete and may not introduce
   * evidence that does not exist in the detection batch.
   */
  const relationshipIds =
    new Set();

  const relationshipCoverage =
    new Map();

  for (
    const relationship
    of detection.candidateRelationships
  ) {
    if (
      relationshipIds.has(
        relationship.candidateRelationshipId,
      )
    ) {
      throw new Error(
        `DUPLICATE CANDIDATE RELATIONSHIP ID: ${relationship.candidateRelationshipId}`,
      );
    }

    relationshipIds.add(
      relationship.candidateRelationshipId,
    );

    for (
      const evidenceId
      of relationship.evidenceIds
    ) {
      const message =
        detectionMessageByEvidenceId.get(
          evidenceId,
        );

      if (!message) {
        throw new Error(
          `CANDIDATE RELATIONSHIP REFERENCES UNKNOWN EVIDENCE: ${relationship.candidateRelationshipId} / ${evidenceId}`,
        );
      }

      if (
        message.subjectKey !==
        relationship.subjectKey
      ) {
        throw new Error(
          `CANDIDATE RELATIONSHIP SUBJECT MISMATCH: ${relationship.candidateRelationshipId} / ${evidenceId}`,
        );
      }

      if (
        relationshipCoverage.has(
          evidenceId,
        )
      ) {
        throw new Error(
          `EVIDENCE APPEARS IN MULTIPLE CANDIDATE RELATIONSHIPS: ${evidenceId}`,
        );
      }

      relationshipCoverage.set(
        evidenceId,
        relationship.candidateRelationshipId,
      );
    }
  }

  for (
    const evidenceId
    of evidenceById.keys()
  ) {
    if (
      !relationshipCoverage.has(
        evidenceId,
      )
    ) {
      throw new Error(
        `EVIDENCE MISSING CANDIDATE RELATIONSHIP: ${evidenceId}`,
      );
    }
  }

  /*
   * Collaborator identity comes only from the explicit
   * USER_CONFIRMED_DIRECTORY.
   *
   * No subject, relationship, opportunity or message content
   * may invent collaborator identity.
   */
  const emailToCollaborator =
    buildCollaboratorDirectoryIndex(
      input.collaboratorDirectory,
    );

  const collaboratorResolutionByEvidenceId =
    new Map();

  for (
    const evidence
    of input.mailEvidence
  ) {
    collaboratorResolutionByEvidenceId.set(
      evidence.evidenceId,
      resolveCollaborator(
        evidence,
        emailToCollaborator,
      ),
    );
  }

  /*
   * Historical known evidence may be outside the current batch,
   * but duplicate/conflicting canonical records are forbidden.
   */
  const knownByRef =
    new Map();

  for (
    const known
    of input.knownEvidence
  ) {
    if (
      knownByRef.has(
        known.evidenceRef,
      )
    ) {
      const previous =
        knownByRef.get(
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

    knownByRef.set(
      known.evidenceRef,
      known,
    );
  }

  /*
   * Authoritative bindings are the only path that may later
   * yield LINK_EXISTING. They must reference current canonical
   * MailEvidence directly.
   */
  const bindingByEvidenceRef =
    new Map();

  for (
    const binding
    of input.authoritativeBindings
  ) {
    if (
      !evidenceById.has(
        binding.evidenceRef,
      )
    ) {
      throw new Error(
        `AUTHORITATIVE BINDING REFERENCES UNKNOWN MAIL EVIDENCE: ${binding.evidenceRef}`,
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
   * Opportunity hints remain non-authoritative.
   * The adapter may later translate them only into candidateMatches.
   * They can never become authoritativeBindings automatically.
   */
  const hintKeys =
    new Set();

  for (
    const hint
    of input.opportunityHints
  ) {
    if (
      hint.evidenceId &&
      !evidenceById.has(
        hint.evidenceId,
      )
    ) {
      throw new Error(
        `OPPORTUNITY HINT REFERENCES UNKNOWN MAIL EVIDENCE: ${hint.evidenceId}`,
      );
    }

    if (
      hint.candidateRelationshipId &&
      !relationshipIds.has(
        hint.candidateRelationshipId,
      )
    ) {
      throw new Error(
        `OPPORTUNITY HINT REFERENCES UNKNOWN CANDIDATE RELATIONSHIP: ${hint.candidateRelationshipId}`,
      );
    }

    const key = [
      hint.evidenceId ?? "",
      hint.candidateRelationshipId ?? "",
      hint.opportunityId,
      hint.matchBasis,
    ].join("::");

    if (
      hintKeys.has(key)
    ) {
      throw new Error(
        `DUPLICATE OPPORTUNITY HINT: ${key}`,
      );
    }

    hintKeys.add(key);
  }

  return {
    collaboratorResolutionByEvidenceId:
      Object.fromEntries(
        [
          ...collaboratorResolutionByEvidenceId.entries(),
        ].sort(
          ([a], [b]) =>
            a.localeCompare(b),
        ),
      ),
  };
}

function validateCollaboratorEvidenceAdapterInput(
  input,
) {
  const validate =
    compileAdapterSchema();

  if (
    !validate(input)
  ) {
    throw new Error(
      `COLLABORATOR EVIDENCE ADAPTER INPUT: INVALID\n${JSON.stringify(
        validate.errors,
        null,
        2,
      )}`,
    );
  }

  return semanticGuard(
    input,
  );
}

function main() {
  const inputPath =
    process.argv[2];

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/validate-collaborator-evidence-adapter-input.js <input.json>",
    );

    process.exit(2);
  }

  try {
    const input =
      loadJson(
        inputPath,
        "COLLABORATOR EVIDENCE ADAPTER INPUT",
      );

    const result =
      validateCollaboratorEvidenceAdapterInput(
        input,
      );

    console.log(
      "COLLABORATOR EVIDENCE ADAPTER INPUT: VALID",
    );

    console.log(
      `COLLABORATOR RESOLUTIONS: ${
        Object.keys(
          result.collaboratorResolutionByEvidenceId,
        ).length
      }`,
    );
  } catch (error) {
    console.error(
      error.message,
    );

    process.exitCode = 1;
  }
}

if (
  require.main === module
) {
  main();
}

module.exports = {
  semanticGuard,
  validateCollaboratorEvidenceAdapterInput,
  buildCollaboratorDirectoryIndex,
  resolveCollaborator,
};
