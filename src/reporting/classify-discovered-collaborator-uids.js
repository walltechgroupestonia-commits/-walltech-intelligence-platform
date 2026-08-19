const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Ajv2020 =
  require("ajv/dist/2020").default;

const addFormats =
  require("ajv-formats");

const discoverySchema =
  require(
    "../mail/mailbox-new-uid-discovery.schema.json"
  );

const classificationSchema =
  require(
    "./collaborator-discovered-uid-eligibility.schema.json"
  );

const {
  acquireEvidenceRecords,
} = require(
  "./run-collaborator-report-operational.js"
);

const {
  buildCollaboratorDirectoryIndex,
  resolveCollaborator,
} = require(
  "./validate-collaborator-evidence-adapter-input.js"
);

function loadJson(
  filePath,
  label,
) {
  const absolutePath =
    path.resolve(
      process.cwd(),
      filePath,
    );

  if (!fs.existsSync(absolutePath)) {
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

function compileSchema(
  schema,
) {
  const ajv =
    new Ajv2020({
      allErrors: true,
      strict: true,
    });

  addFormats(ajv);

  return ajv.compile(
    schema,
  );
}

function assertSchema(
  schema,
  value,
  label,
) {
  const validate =
    compileSchema(
      schema,
    );

  if (!validate(value)) {
    throw new Error(
      `${label}: INVALID\n${JSON.stringify(
        validate.errors,
        null,
        2,
      )}`,
    );
  }
}

function classifyResolutionError(
  error,
) {
  const message =
    String(
      error?.message ??
      error,
    );

  if (
    message.includes(
      "COLLABORATOR UNRESOLVED FOR SELF EVIDENCE",
    )
  ) {
    return "NOT_COLLABORATOR_SELF";
  }

  if (
    message.includes(
      "COLLABORATOR DIRECTION AMBIGUOUS",
    )
  ) {
    return "REVIEW_REQUIRED_DIRECTION_AMBIGUOUS";
  }

  if (
    message.includes(
      "COLLABORATOR AMBIGUOUS FOR EVIDENCE",
    )
  ) {
    return "REVIEW_REQUIRED_AMBIGUOUS";
  }

  if (
    message.includes(
      "COLLABORATOR UNRESOLVED FOR EVIDENCE",
    )
  ) {
    return "NOT_IN_CONFIRMED_DIRECTORY";
  }

  return null;
}

function classifyEvidenceBatch(
  discovery,
  collaboratorDirectory,
  evidenceRecords,
  classifiedAt =
    new Date().toISOString(),
) {
  assertSchema(
    discoverySchema,
    discovery,
    "MAILBOX NEW UID DISCOVERY",
  );

  if (
    !Array.isArray(
      collaboratorDirectory,
    ) ||
    collaboratorDirectory.length === 0
  ) {
    throw new Error(
      "COLLABORATOR DIRECTORY MUST BE NON-EMPTY",
    );
  }

  const directoryIndex =
    buildCollaboratorDirectoryIndex(
      collaboratorDirectory,
    );

  const expectedUids =
    [...discovery.newUids]
      .sort(
        (a, b) =>
          a - b,
      );

  if (
    evidenceRecords.length !==
    expectedUids.length
  ) {
    throw new Error(
      `EVIDENCE COUNT MISMATCH: expected ${expectedUids.length}, got ${evidenceRecords.length}`,
    );
  }

  const evidenceByUid =
    new Map();

  for (
    const evidence
    of evidenceRecords
  ) {
    const uid =
      evidence?.source?.uid;

    if (
      !Number.isSafeInteger(uid) ||
      uid < 1
    ) {
      throw new Error(
        `INVALID EVIDENCE UID: ${uid}`,
      );
    }

    if (
      evidence.source.mailboxPath !==
      discovery.mailboxPath
    ) {
      throw new Error(
        `EVIDENCE MAILBOX MISMATCH FOR UID ${uid}`,
      );
    }

    if (
      evidenceByUid.has(uid)
    ) {
      throw new Error(
        `DUPLICATE EVIDENCE UID: ${uid}`,
      );
    }

    evidenceByUid.set(
      uid,
      evidence,
    );
  }

  const actualUids =
    [...evidenceByUid.keys()]
      .sort(
        (a, b) =>
          a - b,
      );

  if (
    JSON.stringify(actualUids) !==
    JSON.stringify(expectedUids)
  ) {
    throw new Error(
      `DISCOVERY/EVIDENCE UID SET MISMATCH: expected ${expectedUids.join(",")} got ${actualUids.join(",")}`,
    );
  }

  const eligibleItems = [];
  const nonEligibleItems = [];

  for (
    const uid
    of expectedUids
  ) {
    const evidence =
      evidenceByUid.get(uid);

    try {
      const collaborator =
        resolveCollaborator(
          evidence,
          directoryIndex,
        );

      eligibleItems.push({
        uid,

        evidenceId:
          evidence.evidenceId,

        collaboratorId:
          collaborator.collaboratorId,

        collaboratorName:
          collaborator.collaboratorName,

        disposition:
          "ELIGIBLE",
      });
    } catch (error) {
      const disposition =
        classifyResolutionError(
          error,
        );

      if (!disposition) {
        throw error;
      }

      nonEligibleItems.push({
        uid,

        evidenceId:
          evidence.evidenceId,

        disposition,
      });
    }
  }

  const eligibleUids =
    eligibleItems
      .map(
        item =>
          item.uid,
      )
      .sort(
        (a, b) =>
          a - b,
      );

  const result = {
    classificationVersion:
      "1.0",

    classificationType:
      "COLLABORATOR_DISCOVERED_UID_ELIGIBILITY",

    classificationPolicy:
      "CONFIRMED_DIRECTORY_DIRECTIONAL_NO_BUSINESS_INFERENCE_V1",

    accountLookup:
      discovery.accountLookup,

    mailboxPath:
      discovery.mailboxPath,

    sourceDiscoveryAt:
      discovery.discoveredAt,

    eligibleUids,

    eligibleItems,

    nonEligibleItems,

    counts: {
      discovered:
        expectedUids.length,

      eligible:
        eligibleItems.length,

      nonEligible:
        nonEligibleItems.length,
    },

    cursorMutation:
      false,

    mailboxMutation:
      false,

    businessInference:
      false,

    classifiedAt,
  };

  assertSchema(
    classificationSchema,
    result,
    "COLLABORATOR DISCOVERED UID ELIGIBILITY",
  );

  if (
    result.counts.discovered !==
    result.counts.eligible +
    result.counts.nonEligible
  ) {
    throw new Error(
      "CLASSIFICATION COUNT CONSERVATION FAILED",
    );
  }

  return result;
}

function acquireAndClassify(
  discovery,
  collaboratorDirectory,
  dependencies = {},
) {
  const acquireEvidenceRecordsFn =
    dependencies.acquireEvidenceRecordsFn ??
    acquireEvidenceRecords;

  if (
    discovery.newUids.length === 0
  ) {
    return classifyEvidenceBatch(
      discovery,
      collaboratorDirectory,
      [],
    );
  }

  const tempRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "walltech-collaborator-eligibility-",
      ),
    );

  try {
    const evidenceRecords =
      acquireEvidenceRecordsFn(
        {
          accountLookup:
            discovery.accountLookup,

          mailboxPath:
            discovery.mailboxPath,

          uids:
            discovery.newUids,
        },
        tempRoot,
      );

    return classifyEvidenceBatch(
      discovery,
      collaboratorDirectory,
      evidenceRecords,
    );
  } finally {
    fs.rmSync(
      tempRoot,
      {
        recursive: true,
        force: true,
      },
    );

    if (
      fs.existsSync(
        tempRoot,
      )
    ) {
      throw new Error(
        `ELIGIBILITY TEMP CLEANUP FAILED: ${tempRoot}`,
      );
    }
  }
}

function main() {
  const discoveryPath =
    process.argv[2];

  const profilePath =
    process.argv[3];

  const outputPath =
    process.argv[4] ??
    null;

  if (
    !discoveryPath ||
    !profilePath
  ) {
    console.error(
      "Usage: node src/reporting/classify-discovered-collaborator-uids.js <discovery.json> <operational-profile.json> [output.json]",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const discovery =
      loadJson(
        discoveryPath,
        "MAILBOX NEW UID DISCOVERY",
      );

    const profile =
      loadJson(
        profilePath,
        "COLLABORATOR OPERATIONAL PROFILE",
      );

    if (
      !Array.isArray(
        profile.collaboratorDirectory,
      ) ||
      profile.collaboratorDirectory.length === 0
    ) {
      throw new Error(
        "PROFILE COLLABORATOR DIRECTORY MISSING",
      );
    }

    const result =
      acquireAndClassify(
        discovery,
        profile.collaboratorDirectory,
      );

    const json =
      `${JSON.stringify(
        result,
        null,
        2,
      )}\n`;

    if (outputPath) {
      const absoluteOutput =
        path.resolve(
          process.cwd(),
          outputPath,
        );

      fs.mkdirSync(
        path.dirname(
          absoluteOutput,
        ),
        {
          recursive: true,
        },
      );

      fs.writeFileSync(
        absoluteOutput,
        json,
        "utf8",
      );
    } else {
      process.stdout.write(
        json,
      );
    }

    console.error(
      "COLLABORATOR UID ELIGIBILITY: PASS",
    );

    console.error(
      `DISCOVERED: ${result.counts.discovered}`,
    );

    console.error(
      `ELIGIBLE: ${result.counts.eligible}`,
    );

    console.error(
      `NON-ELIGIBLE: ${result.counts.nonEligible}`,
    );

    console.error(
      `ELIGIBLE UIDS: ${
        result.eligibleUids.length
          ? result.eligibleUids.join(",")
          : "NONE"
      }`,
    );

    console.error(
      "BUSINESS INFERENCE: NONE",
    );

    console.error(
      "CURSOR MUTATION: NONE",
    );

    console.error(
      "MAILBOX MUTATION: NONE",
    );
  } catch (error) {
    console.error(
      "COLLABORATOR UID ELIGIBILITY: FAIL",
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
  classifyResolutionError,
  classifyEvidenceBatch,
  acquireAndClassify,
};
