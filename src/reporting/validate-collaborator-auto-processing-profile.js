const fs =
  require("node:fs");

const path =
  require("node:path");

const Ajv2020 =
  require("ajv/dist/2020").default;

const addFormats =
  require("ajv-formats");

const mailEvidenceSchema =
  require(
    "../mail/mail-evidence.schema.json"
  );

const detectionSchema =
  require(
    "../mail/communication-cycle-detection.schema.json"
  );

const reconciliationSchema =
  require(
    "./collaborator-reconciliation-input.schema.json"
  );

const adapterSchema =
  require(
    "./collaborator-evidence-adapter-input.schema.json"
  );

const profileSchema =
  require(
    "./collaborator-auto-processing-profile.schema.json"
  );

const {
  buildCollaboratorDirectoryIndex,
} = require(
  "./validate-collaborator-evidence-adapter-input.js"
);

function compileProfileSchema() {
  const ajv =
    new Ajv2020({
      strict: true,
      allErrors: true,
    });

  addFormats(ajv);

  /*
   * Complete transitive schema closure.
   *
   * The adapter schema references MailEvidence,
   * Communication Detection and Reconciliation.
   * They must all be registered before the
   * automatic profile schema is compiled.
   */
  ajv.addSchema(
    mailEvidenceSchema,
  );

  ajv.addSchema(
    detectionSchema,
  );

  ajv.addSchema(
    reconciliationSchema,
  );

  ajv.addSchema(
    adapterSchema,
  );

  return ajv.compile(
    profileSchema,
  );
}

function nonBlank(
  value,
) {
  return (
    typeof value === "string" &&
    value.trim() !== ""
  );
}

function validateCollaboratorAutoProcessingProfile(
  profile,
) {
  /*
   * Business-attribution coordinates from a
   * historical/manual run are forbidden here.
   *
   * Check before AJV so the failure reason is
   * explicit rather than a generic
   * additionalProperties violation.
   */
  const forbiddenFields = [
    "uids",
    "authoritativeUidBindings",
    "opportunityUidHints"
  ];

  for (
    const field
    of forbiddenFields
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        profile,
        field,
      )
    ) {
      throw new Error(
        `FORBIDDEN AUTOMATIC PROFILE FIELD: ${field}`,
      );
    }
  }

  const validate =
    compileProfileSchema();

  if (!validate(profile)) {
    throw new Error(
      `COLLABORATOR AUTO PROCESSING PROFILE: INVALID\n${JSON.stringify(
        validate.errors,
        null,
        2,
      )}`,
    );
  }

  for (
    const field
    of [
      "profileId",
      "reportIdPrefix",
      "accountLookup",
      "mailboxPath"
    ]
  ) {
    if (
      !nonBlank(
        profile[field],
      )
    ) {
      throw new Error(
        `PROFILE FIELD MUST BE NON-BLANK: ${field}`,
      );
    }
  }

  /*
   * Reuse the same collaborator identity guard
   * already used by the evidence adapter.
   *
   * It rejects duplicate collaborator IDs,
   * duplicate emails and cross-identity email
   * collisions.
   */
  buildCollaboratorDirectoryIndex(
    profile.collaboratorDirectory,
  );

  const knownByRef =
    new Map();

  for (
    const known
    of profile.knownEvidence
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

  return {
    valid:
      true,

    collaboratorCount:
      profile.collaboratorDirectory.length,

    knownEvidenceCount:
      profile.knownEvidence.length,

    businessInference:
      false,
  };
}

function main() {
  const inputPath =
    process.argv[2];

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/validate-collaborator-auto-processing-profile.js <profile.json>",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const absolutePath =
      path.resolve(
        process.cwd(),
        inputPath,
      );

    const profile =
      JSON.parse(
        fs.readFileSync(
          absolutePath,
          "utf8",
        ),
      );

    const result =
      validateCollaboratorAutoProcessingProfile(
        profile,
      );

    console.log(
      "COLLABORATOR AUTO PROCESSING PROFILE: VALID",
    );

    console.log(
      `PROFILE: ${profile.profileId}`,
    );

    console.log(
      `ACCOUNT: ${profile.accountLookup}`,
    );

    console.log(
      `MAILBOX: ${profile.mailboxPath}`,
    );

    console.log(
      `COLLABORATORS: ${result.collaboratorCount}`,
    );

    console.log(
      `KNOWN EVIDENCE: ${result.knownEvidenceCount}`,
    );

    console.log(
      "AUTOMATIC BUSINESS BINDING: NONE",
    );

    console.log(
      "AUTOMATIC OPPORTUNITY HINT: NONE",
    );
  } catch (error) {
    console.error(
      "COLLABORATOR AUTO PROCESSING PROFILE: INVALID",
    );

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
  compileProfileSchema,
  validateCollaboratorAutoProcessingProfile,
};
