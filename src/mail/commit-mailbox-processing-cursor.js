const crypto =
  require("node:crypto");

const fs =
  require("node:fs");

const path =
  require("node:path");

const Ajv2020 =
  require("ajv/dist/2020").default;

const addFormats =
  require("ajv-formats");

const auditSchema =
  require(
    "./mailbox-cursor-commit-audit.schema.json"
  );

const {
  validateMailboxProcessingCursor,
} = require(
  "./validate-mailbox-processing-cursor.js"
);

const {
  buildMailboxCursorAdvanceProposal,
} = require(
  "./build-mailbox-cursor-advance-proposal.js"
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

function canonicalize(
  value,
) {
  if (Array.isArray(value)) {
    return value.map(
      canonicalize,
    );
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(
          key => [
            key,
            canonicalize(
              value[key],
            ),
          ],
        ),
    );
  }

  return value;
}

function canonicalJson(
  value,
) {
  return `${JSON.stringify(
    canonicalize(value),
    null,
    2,
  )}\n`;
}

function sha256(
  value,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(value)
    .digest("hex");
}

function validateAudit(
  audit,
) {
  const ajv =
    new Ajv2020({
      strict: true,
      allErrors: true,
    });

  addFormats(ajv);

  const validate =
    ajv.compile(
      auditSchema,
    );

  if (!validate(audit)) {
    throw new Error(
      `CURSOR COMMIT AUDIT INVALID\n${JSON.stringify(
        validate.errors,
        null,
        2,
      )}`,
    );
  }

  if (
    audit.status === "PREPARED" &&
    (
      audit.finishedAt !== null ||
      audit.error !== null
    )
  ) {
    throw new Error(
      "PREPARED AUDIT SEMANTICS INVALID",
    );
  }

  if (
    audit.status === "COMMITTED" &&
    (
      typeof audit.finishedAt !==
        "string" ||
      audit.error !== null
    )
  ) {
    throw new Error(
      "COMMITTED AUDIT SEMANTICS INVALID",
    );
  }

  if (
    audit.status === "ABORTED" &&
    (
      typeof audit.finishedAt !==
        "string" ||
      typeof audit.error !==
        "string" ||
      audit.error.trim() === ""
    )
  ) {
    throw new Error(
      "ABORTED AUDIT SEMANTICS INVALID",
    );
  }

  return true;
}

function fsyncDirectory(
  directory,
) {
  let fd;

  try {
    fd =
      fs.openSync(
        directory,
        "r",
      );

    fs.fsyncSync(fd);
  } finally {
    if (
      fd !== undefined
    ) {
      fs.closeSync(fd);
    }
  }
}

function writeAtomically(
  targetPath,
  content,
) {
  const directory =
    path.dirname(
      targetPath,
    );

  fs.mkdirSync(
    directory,
    {
      recursive: true,
    },
  );

  const temporaryPath =
    path.join(
      directory,
      `.${path.basename(
        targetPath,
      )}.tmp-${process.pid}-${crypto.randomUUID()}`,
    );

  let fd;

  try {
    fd =
      fs.openSync(
        temporaryPath,
        "wx",
        0o600,
      );

    fs.writeFileSync(
      fd,
      content,
      "utf8",
    );

    fs.fsyncSync(fd);

    fs.closeSync(fd);
    fd = undefined;

    fs.renameSync(
      temporaryPath,
      targetPath,
    );

    fsyncDirectory(
      directory,
    );
  } finally {
    if (
      fd !== undefined
    ) {
      fs.closeSync(fd);
    }

    if (
      fs.existsSync(
        temporaryPath,
      )
    ) {
      fs.rmSync(
        temporaryPath,
        {
          force: true,
        },
      );
    }
  }
}

function writeAuditJson(
  auditDir,
  fileName,
  value,
) {
  const target =
    path.join(
      auditDir,
      fileName,
    );

  writeAtomically(
    target,
    canonicalJson(
      value,
    ),
  );

  return target;
}

function assertProposalRebuild(
  cursor,
  discovery,
  classification,
  receipt,
  proposal,
) {
  const rebuilt =
    buildMailboxCursorAdvanceProposal(
      cursor,
      discovery,
      classification,
      receipt,
      proposal.builtAt,
    );

  if (
    canonicalJson(rebuilt) !==
    canonicalJson(proposal)
  ) {
    throw new Error(
      "PROPOSAL DOES NOT MATCH SOURCE ARTIFACTS",
    );
  }

  return true;
}

function buildNextCursor(
  cursor,
  proposal,
  updatedAt,
) {
  if (
    proposal.decision !==
    "ADVANCE_ALLOWED"
  ) {
    throw new Error(
      "NEXT CURSOR REQUESTED WITHOUT ADVANCE DECISION",
    );
  }

  if (
    proposal.targetBoundaryUid <=
    cursor.boundaryUid
  ) {
    throw new Error(
      "TARGET CURSOR MUST ADVANCE MONOTONICALLY",
    );
  }

  if (
    proposal.targetBoundaryUid >=
    proposal.observedUidNext
  ) {
    throw new Error(
      "TARGET CURSOR MUST REMAIN BELOW OBSERVED UIDNEXT",
    );
  }

  const nextCursor = {
    ...cursor,

    boundaryUid:
      proposal.targetBoundaryUid,

    boundaryKind:
      proposal.targetBoundaryKind,

    lastObservedUidNext:
      proposal.observedUidNext,

    lastObservedHighestModseq:
      proposal.observedHighestModseq,

    updatedAt,
  };

  const validation =
    validateMailboxProcessingCursor(
      nextCursor,
    );

  if (!validation.valid) {
    throw new Error(
      `NEXT CURSOR INVALID: ${JSON.stringify(
        validation.errors,
      )}`,
    );
  }

  return nextCursor;
}

function commitMailboxProcessingCursor(
  {
    cursorPath,
    discovery,
    classification,
    receipt,
    proposal,
    auditRoot =
      "runtime/audit/mailbox-cursor",
  },
  dependencies = {},
) {
  const absoluteCursorPath =
    path.resolve(
      process.cwd(),
      cursorPath,
    );

  if (
    !fs.existsSync(
      absoluteCursorPath,
    )
  ) {
    throw new Error(
      `CURSOR NOT FOUND: ${cursorPath}`,
    );
  }

  const cursorBytes =
    fs.readFileSync(
      absoluteCursorPath,
    );

  const cursor =
    JSON.parse(
      cursorBytes.toString(
        "utf8",
      ),
    );

  const cursorValidation =
    validateMailboxProcessingCursor(
      cursor,
    );

  if (!cursorValidation.valid) {
    throw new Error(
      "CURRENT CURSOR INVALID",
    );
  }

  assertProposalRebuild(
    cursor,
    discovery,
    classification,
    receipt,
    proposal,
  );

  if (
    proposal.decision ===
    "NO_ADVANCE"
  ) {
    if (
      proposal.targetBoundaryUid !==
      cursor.boundaryUid
    ) {
      throw new Error(
        "NO-ADVANCE PROPOSAL CHANGES BOUNDARY",
      );
    }

    return {
      status:
        "NO_ADVANCE",

      commitId:
        null,

      auditDir:
        null,

      boundaryBefore:
        cursor.boundaryUid,

      boundaryAfter:
        cursor.boundaryUid,

      cursorMutation:
        false,
    };
  }

  if (
    proposal.decision !==
    "ADVANCE_ALLOWED"
  ) {
    throw new Error(
      `UNSUPPORTED PROPOSAL DECISION: ${proposal.decision}`,
    );
  }

  const beforeCursorSha256 =
    sha256(
      cursorBytes,
    );

  const preparedAt =
    new Date().toISOString();

  const nextCursor =
    buildNextCursor(
      cursor,
      proposal,
      preparedAt,
    );

  const nextCursorContent =
    canonicalJson(
      nextCursor,
    );

  const intendedAfterCursorSha256 =
    sha256(
      nextCursorContent,
    );

  const proposalSha256 =
    sha256(
      canonicalJson(
        proposal,
      ),
    );

  const commitId =
    `MCCC-${crypto.randomUUID()}`;

  const absoluteAuditRoot =
    path.resolve(
      process.cwd(),
      auditRoot,
    );

  fs.mkdirSync(
    absoluteAuditRoot,
    {
      recursive: true,
    },
  );

  const auditDir =
    path.join(
      absoluteAuditRoot,
      commitId,
    );

  fs.mkdirSync(
    auditDir,
  );

  writeAuditJson(
    auditDir,
    "cursor-before.json",
    cursor,
  );

  writeAuditJson(
    auditDir,
    "discovery.json",
    discovery,
  );

  writeAuditJson(
    auditDir,
    "classification.json",
    classification,
  );

  writeAuditJson(
    auditDir,
    "processing-receipt.json",
    receipt,
  );

  writeAuditJson(
    auditDir,
    "proposal.json",
    proposal,
  );

  writeAuditJson(
    auditDir,
    "cursor-after-intended.json",
    nextCursor,
  );

  const preparedAudit = {
    auditVersion:
      "1.0",

    auditType:
      "MAILBOX_CURSOR_COMMIT_AUDIT",

    auditPolicy:
      "AUDIT_PREPARED_BEFORE_ATOMIC_CURSOR_REPLACE_V1",

    commitId,

    status:
      "PREPARED",

    accountLookup:
      cursor.accountLookup,

    mailboxPath:
      cursor.mailboxPath,

    uidValidity:
      cursor.uidValidity,

    currentBoundaryUid:
      cursor.boundaryUid,

    targetBoundaryUid:
      proposal.targetBoundaryUid,

    cursorPath:
      absoluteCursorPath,

    beforeCursorSha256,

    intendedAfterCursorSha256,

    proposalSha256,

    preparedAt,

    finishedAt:
      null,

    error:
      null,
  };

  validateAudit(
    preparedAudit,
  );

  writeAuditJson(
    auditDir,
    "transaction-prepared.json",
    preparedAudit,
  );

  const beforeCursorReplaceFn =
    dependencies.beforeCursorReplaceFn ??
    (() => {});

  let cursorReplaced =
    false;

  try {
    /*
     * At this exact point all source artifacts,
     * before-state, intended after-state and the
     * PREPARED transaction record already exist.
     */
    beforeCursorReplaceFn({
      auditDir,
      cursorPath:
        absoluteCursorPath,
      beforeCursorSha256,
      intendedAfterCursorSha256,
    });

    /*
     * Compare-and-swap guard.
     *
     * The cursor may not have changed between
     * proposal preparation and physical replace.
     */
    const currentBytes =
      fs.readFileSync(
        absoluteCursorPath,
      );

    const currentSha256 =
      sha256(
        currentBytes,
      );

    if (
      currentSha256 !==
      beforeCursorSha256
    ) {
      throw new Error(
        "CURSOR CHANGED AFTER AUDIT PREPARE",
      );
    }

    writeAtomically(
      absoluteCursorPath,
      nextCursorContent,
    );

    cursorReplaced =
      true;

    const committedBytes =
      fs.readFileSync(
        absoluteCursorPath,
      );

    const committedSha256 =
      sha256(
        committedBytes,
      );

    if (
      committedSha256 !==
      intendedAfterCursorSha256
    ) {
      throw new Error(
        "COMMITTED CURSOR HASH MISMATCH",
      );
    }

    const committedCursor =
      JSON.parse(
        committedBytes.toString(
          "utf8",
        ),
      );

    const committedValidation =
      validateMailboxProcessingCursor(
        committedCursor,
      );

    if (
      !committedValidation.valid
    ) {
      throw new Error(
        "COMMITTED CURSOR FAILED VALIDATION",
      );
    }

    writeAuditJson(
      auditDir,
      "cursor-after.json",
      committedCursor,
    );

    const committedAudit = {
      ...preparedAudit,

      status:
        "COMMITTED",

      finishedAt:
        new Date().toISOString(),

      error:
        null,
    };

    validateAudit(
      committedAudit,
    );

    writeAuditJson(
      auditDir,
      "transaction-committed.json",
      committedAudit,
    );

    return {
      status:
        "COMMITTED",

      commitId,

      auditDir,

      boundaryBefore:
        cursor.boundaryUid,

      boundaryAfter:
        committedCursor.boundaryUid,

      beforeCursorSha256,

      afterCursorSha256:
        committedSha256,

      cursorMutation:
        true,
    };
  } catch (error) {
    if (!cursorReplaced) {
      const abortedAudit = {
        ...preparedAudit,

        status:
          "ABORTED",

        finishedAt:
          new Date().toISOString(),

        error:
          String(
            error?.message ??
            error,
          ),
      };

      validateAudit(
        abortedAudit,
      );

      try {
        writeAuditJson(
          auditDir,
          "transaction-aborted.json",
          abortedAudit,
        );
      } catch {
        // Preserve original failure.
      }
    } else {
      /*
       * Cursor replacement already happened.
       * Never mislabel the transaction as aborted.
       * PREPARED + intended cursor hash remain
       * sufficient recovery evidence.
       */
      try {
        fs.writeFileSync(
          path.join(
            auditDir,
            "post-commit-finalization-error.txt",
          ),
          `${String(
            error?.stack ??
            error,
          )}\n`,
          "utf8",
        );
      } catch {
        // Preserve original failure.
      }
    }

    throw error;
  }
}

function main() {
  const cursorPath =
    process.argv[2];

  const discoveryPath =
    process.argv[3];

  const classificationPath =
    process.argv[4];

  const receiptPath =
    process.argv[5];

  const proposalPath =
    process.argv[6];

  const auditRoot =
    process.argv[7] ??
    "runtime/audit/mailbox-cursor";

  if (
    !cursorPath ||
    !discoveryPath ||
    !classificationPath ||
    !receiptPath ||
    !proposalPath
  ) {
    console.error(
      "Usage: node src/mail/commit-mailbox-processing-cursor.js <cursor.json> <discovery.json> <classification.json> <receipt.json> <proposal.json> [audit-root]",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const result =
      commitMailboxProcessingCursor({
        cursorPath,

        discovery:
          loadJson(
            discoveryPath,
            "DISCOVERY",
          ),

        classification:
          loadJson(
            classificationPath,
            "CLASSIFICATION",
          ),

        receipt:
          loadJson(
            receiptPath,
            "PROCESSING RECEIPT",
          ),

        proposal:
          loadJson(
            proposalPath,
            "CURSOR ADVANCE PROPOSAL",
          ),

        auditRoot,
      });

    console.log(
      "MAILBOX CURSOR COMMIT: PASS",
    );

    console.log(
      `STATUS: ${result.status}`,
    );

    console.log(
      `BOUNDARY BEFORE: ${result.boundaryBefore}`,
    );

    console.log(
      `BOUNDARY AFTER: ${result.boundaryAfter}`,
    );

    console.log(
      `CURSOR MUTATION: ${
        result.cursorMutation
          ? "YES"
          : "NONE"
      }`,
    );

    if (result.commitId) {
      console.log(
        `COMMIT ID: ${result.commitId}`,
      );

      console.log(
        `AUDIT DIR: ${result.auditDir}`,
      );
    }
  } catch (error) {
    console.error(
      "MAILBOX CURSOR COMMIT: FAIL",
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
  canonicalize,
  canonicalJson,
  sha256,
  validateAudit,
  writeAtomically,
  assertProposalRebuild,
  buildNextCursor,
  commitMailboxProcessingCursor,
};
