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

const {
  buildCollaboratorDirectoryIndex,
} = require(
  "./validate-collaborator-evidence-adapter-input.js"
);

const SCHEMA_PATHS = {
  mailEvidence:
    "src/mail/mail-evidence.schema.json",

  detection:
    "src/mail/communication-cycle-detection.schema.json",

  reconciliation:
    "src/reporting/collaborator-reconciliation-input.schema.json",

  adapter:
    "src/reporting/collaborator-evidence-adapter-input.schema.json",

  operationalRun:
    "src/reporting/collaborator-report-operational-run-input.schema.json",
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

function compileOperationalRunSchema() {
  const schemas = {
    mailEvidence:
      loadJson(
        SCHEMA_PATHS.mailEvidence,
        "MAIL EVIDENCE SCHEMA",
      ),

    detection:
      loadJson(
        SCHEMA_PATHS.detection,
        "COMMUNICATION DETECTION SCHEMA",
      ),

    reconciliation:
      loadJson(
        SCHEMA_PATHS.reconciliation,
        "RECONCILIATION INPUT SCHEMA",
      ),

    adapter:
      loadJson(
        SCHEMA_PATHS.adapter,
        "EVIDENCE ADAPTER INPUT SCHEMA",
      ),

    operationalRun:
      loadJson(
        SCHEMA_PATHS.operationalRun,
        "OPERATIONAL RUN INPUT SCHEMA",
      ),
  };

  const ajv =
    new Ajv2020({
      allErrors: true,
      strict: true,
    });

  addFormats(ajv);

  ajv.addSchema(
    schemas.mailEvidence,
  );

  ajv.addSchema(
    schemas.detection,
  );

  ajv.addSchema(
    schemas.reconciliation,
  );

  ajv.addSchema(
    schemas.adapter,
  );

  return ajv.compile(
    schemas.operationalRun,
  );
}

function assertNonBlank(
  value,
  label,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `${label} MUST BE NON-BLANK`,
    );
  }
}

function buildRequestedUidSet(
  uids,
) {
  return new Set(
    uids,
  );
}

function validateKnownEvidence(
  knownEvidence,
) {
  const byEvidenceRef =
    new Map();

  const bySourceSha256 =
    new Map();

  for (
    const record
    of knownEvidence
  ) {
    assertNonBlank(
      record.evidenceRef,
      "KNOWN EVIDENCE REF",
    );

    if (
      byEvidenceRef.has(
        record.evidenceRef,
      )
    ) {
      const prior =
        byEvidenceRef.get(
          record.evidenceRef,
        );

      if (
        prior.sourceSha256 !==
        record.sourceSha256
      ) {
        throw new Error(
          `KNOWN EVIDENCE CONFLICT FOR EVIDENCE REF: ${record.evidenceRef}`,
        );
      }

      throw new Error(
        `DUPLICATE KNOWN EVIDENCE REF: ${record.evidenceRef}`,
      );
    }

    byEvidenceRef.set(
      record.evidenceRef,
      record,
    );

    if (
      record.sourceSha256 !== null
    ) {
      if (
        bySourceSha256.has(
          record.sourceSha256,
        )
      ) {
        const priorEvidenceRef =
          bySourceSha256.get(
            record.sourceSha256,
          );

        if (
          priorEvidenceRef !==
          record.evidenceRef
        ) {
          throw new Error(
            `KNOWN EVIDENCE SOURCE HASH CONFLICT: ${record.sourceSha256}`,
          );
        }

        throw new Error(
          `DUPLICATE KNOWN EVIDENCE SOURCE HASH: ${record.sourceSha256}`,
        );
      }

      bySourceSha256.set(
        record.sourceSha256,
        record.evidenceRef,
      );
    }
  }
}

function validateAuthoritativeUidBindings(
  bindings,
  requestedUidSet,
) {
  const bindingByUid =
    new Map();

  for (
    const binding
    of bindings
  ) {
    if (
      !requestedUidSet.has(
        binding.uid,
      )
    ) {
      throw new Error(
        `AUTHORITATIVE BINDING UID NOT REQUESTED: ${binding.uid}`,
      );
    }

    assertNonBlank(
      binding.opportunityId,
      `AUTHORITATIVE BINDING OPPORTUNITY ${binding.uid}`,
    );

    if (
      bindingByUid.has(
        binding.uid,
      )
    ) {
      const prior =
        bindingByUid.get(
          binding.uid,
        );

      if (
        prior.opportunityId !==
          binding.opportunityId ||
        prior.bindingSource !==
          binding.bindingSource
      ) {
        throw new Error(
          `CONFLICTING AUTHORITATIVE UID BINDING: ${binding.uid}`,
        );
      }

      throw new Error(
        `DUPLICATE AUTHORITATIVE UID BINDING: ${binding.uid}`,
      );
    }

    bindingByUid.set(
      binding.uid,
      binding,
    );
  }

  return bindingByUid;
}

function validateOpportunityUidHints(
  hints,
  requestedUidSet,
) {
  const exactKeys =
    new Set();

  for (
    const hint
    of hints
  ) {
    if (
      !requestedUidSet.has(
        hint.uid,
      )
    ) {
      throw new Error(
        `OPPORTUNITY HINT UID NOT REQUESTED: ${hint.uid}`,
      );
    }

    assertNonBlank(
      hint.opportunityId,
      `OPPORTUNITY HINT OPPORTUNITY ${hint.uid}`,
    );

    const key = [
      hint.uid,
      hint.opportunityId,
      hint.matchBasis,
    ].join("::");

    if (
      exactKeys.has(
        key,
      )
    ) {
      throw new Error(
        `DUPLICATE OPPORTUNITY UID HINT: ${key}`,
      );
    }

    exactKeys.add(
      key,
    );
  }
}

function semanticGuard(
  input,
) {
  assertNonBlank(
    input.reportId,
    "REPORT ID",
  );

  assertNonBlank(
    input.accountLookup,
    "ACCOUNT LOOKUP",
  );

  assertNonBlank(
    input.mailboxPath,
    "MAILBOX PATH",
  );

  /*
   * Schema uniqueItems already protects the list,
   * but semantic validation keeps the runtime contract explicit.
   */
  const requestedUidSet =
    buildRequestedUidSet(
      input.uids,
    );

  if (
    requestedUidSet.size !==
    input.uids.length
  ) {
    throw new Error(
      "DUPLICATE REQUESTED UID",
    );
  }

  /*
   * Reuse the exact collaborator-directory safety
   * already established in AZIONE 16.
   *
   * This rejects duplicate collaborator IDs and
   * case-insensitive email ownership collisions.
   */
  buildCollaboratorDirectoryIndex(
    input.collaboratorDirectory,
  );

  validateKnownEvidence(
    input.knownEvidence,
  );

  const authoritativeBindingByUid =
    validateAuthoritativeUidBindings(
      input.authoritativeUidBindings,
      requestedUidSet,
    );

  validateOpportunityUidHints(
    input.opportunityUidHints,
    requestedUidSet,
  );

  return {
    requestedUids:
      [...requestedUidSet]
        .sort(
          (a, b) =>
            a - b,
        ),

    authoritativeBindingUids:
      [...authoritativeBindingByUid.keys()]
        .sort(
          (a, b) =>
            a - b,
        ),

    opportunityHintCount:
      input.opportunityUidHints.length,
  };
}

function validateCollaboratorReportOperationalRunInput(
  input,
) {
  const validate =
    compileOperationalRunSchema();

  if (
    !validate(
      input,
    )
  ) {
    throw new Error(
      `COLLABORATOR REPORT OPERATIONAL RUN INPUT: INVALID\n${JSON.stringify(
        validate.errors,
        null,
        2,
      )}`,
    );
  }

  const semantic =
    semanticGuard(
      input,
    );

  return semantic;
}

function main() {
  const inputPath =
    process.argv[2];

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/validate-collaborator-report-operational-run-input.js <operational-run-input.json>",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const input =
      loadJson(
        inputPath,
        "COLLABORATOR REPORT OPERATIONAL RUN INPUT",
      );

    const semantic =
      validateCollaboratorReportOperationalRunInput(
        input,
      );

    console.log(
      "COLLABORATOR REPORT OPERATIONAL RUN INPUT: VALID",
    );

    console.log(
      `UIDS: ${semantic.requestedUids.join(",")}`,
    );

    console.log(
      `AUTHORITATIVE UID BINDINGS: ${semantic.authoritativeBindingUids.length}`,
    );

    console.log(
      `OPPORTUNITY UID HINTS: ${semantic.opportunityHintCount}`,
    );

    console.log(
      "BUSINESS INFERENCE: NONE",
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
  compileOperationalRunSchema,
  semanticGuard,
  validateCollaboratorReportOperationalRunInput,
  validateKnownEvidence,
  validateAuthoritativeUidBindings,
  validateOpportunityUidHints,
};
