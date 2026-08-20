const crypto =
  require("node:crypto");

const fs =
  require("node:fs");

const path =
  require("node:path");

const {
  validateCollaboratorAutoProcessingProfile,
} = require(
  "./validate-collaborator-auto-processing-profile.js"
);

const {
  validateMailboxProcessingCursor,
} = require(
  "../mail/validate-mailbox-processing-cursor.js"
);

const {
  discoverNewMailboxUids,
} = require(
  "../mail/discover-new-mailbox-uids.js"
);

const {
  acquireAndClassify,
} = require(
  "./classify-discovered-collaborator-uids.js"
);

const {
  processingEligibleUidsForClassification,
  buildMailboxCursorAdvanceProposal,
} = require(
  "../mail/build-mailbox-cursor-advance-proposal.js"
);

const {
  runOperationalCollaboratorReport,
} = require(
  "./run-collaborator-report-operational.js"
);

const {
  DEFAULT_OUTPUT_DIR,
  safeReportId,
  writeCollaboratorReportSurface,
} = require(
  "./write-collaborator-report-surface.js"
);

const {
  canonicalJson,
  writeAtomically,
  commitMailboxProcessingCursor,
} = require(
  "../mail/commit-mailbox-processing-cursor.js"
);

const mailAccountRegistry =
  require(
    "../mail/mail-account-registry.json"
  );

const {
  buildCollaboratorRegistryCandidates,
} = require(
  "./build-collaborator-registry-candidates.js"
);

const {
  persistCollaboratorRegistry,
} = require(
  "./persist-collaborator-registry.js"
);

function walltechOwnAddresses() {
  return mailAccountRegistry.accounts
    .flatMap(
      account => [
        account.mailboxUser,
        ...(account.routingAddresses || []),
      ],
    )
    .filter(Boolean);
}

function buildConfirmedRegistryBootstrap(
  collaboratorDirectory,
) {
  if (
    !Array.isArray(
      collaboratorDirectory,
    )
  ) {
    throw new Error(
      "CONFIRMED COLLABORATOR DIRECTORY MUST BE AN ARRAY",
    );
  }

  return {
    registryVersion:
      "1.0",

    registryType:
      "WALLTECH_COLLABORATOR_REGISTRY",

    collaborators:
      collaboratorDirectory.map(
        collaborator => {
          const emailAddresses =
            [
              ...new Set(
                (
                  collaborator.emailAddresses ||
                  []
                )
                  .map(
                    value =>
                      String(value)
                        .trim()
                        .toLowerCase(),
                  )
                  .filter(Boolean),
              ),
            ].sort();

          if (
            emailAddresses.length === 0
          ) {
            throw new Error(
              `CONFIRMED COLLABORATOR WITHOUT EMAIL: ${collaborator.collaboratorId || "UNKNOWN"}`,
            );
          }

          return {
            collaboratorId:
              collaborator.collaboratorId,

            displayName:
              collaborator.collaboratorName ??
              collaborator.displayName ??
              null,

            emailAddresses,

            registryStatus:
              "CONFIRMED",

            identitySource:
              "USER_CONFIRMED_DIRECTORY",

            evidenceRefs:
              [],
          };
        },
      ),
  };
}

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

function validateCoordinates(
  profile,
  cursor,
) {
  if (
    profile.accountLookup !==
    cursor.accountLookup
  ) {
    throw new Error(
      `PROFILE/CURSOR ACCOUNT MISMATCH: ${profile.accountLookup} != ${cursor.accountLookup}`,
    );
  }

  if (
    profile.mailboxPath !==
    cursor.mailboxPath
  ) {
    throw new Error(
      `PROFILE/CURSOR MAILBOX MISMATCH: ${profile.mailboxPath} != ${cursor.mailboxPath}`,
    );
  }

  return true;
}

function deterministicReportId(
  profile,
  cursor,
  processingUids,
) {
  if (
    !Array.isArray(
      processingUids,
    ) ||
    processingUids.length === 0
  ) {
    throw new Error(
      "REPORT ID REQUIRES AT LEAST ONE PROCESSING UID",
    );
  }

  const sorted =
    [...processingUids]
      .sort(
        (a, b) =>
          a - b,
      );

  const value =
    [
      profile.reportIdPrefix,
      `UV${cursor.uidValidity}`,
      `U${sorted.join("-")}`,
    ].join("-");

  return safeReportId(
    value,
  );
}

function buildOperationalRunInput(
  profile,
  reportId,
  processingUids,
) {
  return {
    runVersion:
      "1.0",

    runType:
      "COLLABORATOR_REPORT_OPERATIONAL_RUN_INPUT",

    runPolicy:
      "EXPLICIT_UID_ACQUISITION_NO_BUSINESS_INFERENCE_V1",

    reportId,

    accountLookup:
      profile.accountLookup,

    mailboxPath:
      profile.mailboxPath,

    uids:
      [...processingUids],

    collaboratorDirectory:
      profile.collaboratorDirectory,

    knownEvidence:
      profile.knownEvidence,

    /*
     * Deliberately empty.
     * Automatic discovery is never authority
     * for commercial/business attribution.
     */
    authoritativeUidBindings:
      [],

    opportunityUidHints:
      [],
  };
}

function buildProcessingReceipt(
  classification,
  processingUids,
  reportOutcome,
  completedAt =
    new Date().toISOString(),
) {
  if (
    processingUids.length === 0
  ) {
    return {
      receiptVersion:
        "1.0",

      receiptType:
        "COLLABORATOR_ELIGIBLE_PROCESSING_RECEIPT",

      receiptPolicy:
        "EXPLICIT_PROCESSING_OUTCOME_NO_CURSOR_MUTATION_V1",

      accountLookup:
        classification.accountLookup,

      mailboxPath:
        classification.mailboxPath,

      sourceDiscoveryAt:
        classification.sourceDiscoveryAt,

      eligibleUids:
        [],

      successfulUids:
        [],

      failedUids:
        [],

      status:
        "NOT_REQUIRED",

      reportId:
        null,

      cursorMutation:
        false,

      completedAt,
    };
  }

  if (
    reportOutcome.success === true
  ) {
    return {
      receiptVersion:
        "1.0",

      receiptType:
        "COLLABORATOR_ELIGIBLE_PROCESSING_RECEIPT",

      receiptPolicy:
        "EXPLICIT_PROCESSING_OUTCOME_NO_CURSOR_MUTATION_V1",

      accountLookup:
        classification.accountLookup,

      mailboxPath:
        classification.mailboxPath,

      sourceDiscoveryAt:
        classification.sourceDiscoveryAt,

      eligibleUids:
        [...processingUids],

      successfulUids:
        [...processingUids],

      failedUids:
        [],

      status:
        "SUCCESS",

      reportId:
        reportOutcome.reportId,

      cursorMutation:
        false,

      completedAt,
    };
  }

  return {
    receiptVersion:
      "1.0",

    receiptType:
      "COLLABORATOR_ELIGIBLE_PROCESSING_RECEIPT",

    receiptPolicy:
      "EXPLICIT_PROCESSING_OUTCOME_NO_CURSOR_MUTATION_V1",

    accountLookup:
      classification.accountLookup,

    mailboxPath:
      classification.mailboxPath,

    sourceDiscoveryAt:
      classification.sourceDiscoveryAt,

    eligibleUids:
      [...processingUids],

    successfulUids:
      [],

    failedUids:
      [...processingUids],

    status:
      "FAILED",

    reportId:
      null,

    cursorMutation:
      false,

    completedAt,
  };
}

function summarizeStatus(
  {
    discovery,
    processingUids,
    reportOutcome,
    proposal,
    commitResult,
  },
) {
  if (
    discovery.status ===
    "NO_NEW_MESSAGES"
  ) {
    return "NO_NEW_MESSAGES";
  }

  const hasReviewBlocker =
    proposal.blockingItems.some(
      item =>
        item.reason ===
          "REVIEW_REQUIRED_AMBIGUOUS" ||
        item.reason ===
          "REVIEW_REQUIRED_DIRECTION_AMBIGUOUS",
    );

  const hasProcessingFailure =
    proposal.blockingItems.some(
      item =>
        item.reason ===
        "ELIGIBLE_PROCESSING_FAILED",
    );

  if (hasProcessingFailure) {
    return (
      commitResult.boundaryAfter >
      commitResult.boundaryBefore
        ? "PARTIAL_ADVANCE_PROCESSING_FAILED"
        : "BLOCKED_PROCESSING_FAILED"
    );
  }

  if (hasReviewBlocker) {
    return (
      commitResult.boundaryAfter >
      commitResult.boundaryBefore
        ? "PARTIAL_ADVANCE_REVIEW_REQUIRED"
        : "BLOCKED_REVIEW_REQUIRED"
    );
  }

  if (
    processingUids.length === 0
  ) {
    return "HANDLED_NO_REPORT";
  }

  if (
    reportOutcome.success === true
  ) {
    return "REPORT_COMMITTED";
  }

  return "COMPLETED";
}

function writeCycleArtifact(
  cycleDir,
  fileName,
  value,
) {
  const target =
    path.join(
      cycleDir,
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

function writeLatestCycle(
  auditRoot,
  result,
) {
  writeAtomically(
    path.join(
      auditRoot,
      "latest.json",
    ),
    canonicalJson(
      result,
    ),
  );
}

async function runCollaboratorAutoCycle(
  {
    profilePath,
    cursorPath,
    mode =
      "COMMIT",

    reportOutputDir =
      DEFAULT_OUTPUT_DIR,

    auditRoot =
      "runtime/audit/collaborator-auto-cycle",

    registryPath =
      "runtime/state/collaborators/registry.json",
  },
  dependencies = {},
) {
  if (
    mode !== "COMMIT" &&
    mode !== "DRY_RUN"
  ) {
    throw new Error(
      `UNSUPPORTED AUTO CYCLE MODE: ${mode}`,
    );
  }

  const profile =
    loadJson(
      profilePath,
      "COLLABORATOR AUTO PROCESSING PROFILE",
    );

  validateCollaboratorAutoProcessingProfile(
    profile,
  );

  const cursor =
    loadJson(
      cursorPath,
      "MAILBOX PROCESSING CURSOR",
    );

  const cursorValidation =
    validateMailboxProcessingCursor(
      cursor,
    );

  if (!cursorValidation.valid) {
    throw new Error(
      `MAILBOX PROCESSING CURSOR INVALID: ${JSON.stringify(
        cursorValidation.errors,
      )}`,
    );
  }

  validateCoordinates(
    profile,
    cursor,
  );

  const absoluteRegistryPath =
    path.resolve(
      process.cwd(),
      registryPath,
    );

  /*
   * COMMIT only.
   *
   * The profile directory is already explicit human authority.
   * It initializes/promotes confirmed identities in the global
   * registry without adding business attribution.
   */
  if (mode === "COMMIT") {
    persistCollaboratorRegistry({
      registryPath:
        absoluteRegistryPath,

      incomingRegistry:
        buildConfirmedRegistryBootstrap(
          profile.collaboratorDirectory,
        ),
    });
  }

  const cycleId =
    `CAC-${crypto.randomUUID()}`;

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

  const cycleDir =
    path.join(
      absoluteAuditRoot,
      cycleId,
    );

  fs.mkdirSync(
    cycleDir,
  );

  const startedAt =
    new Date().toISOString();

  writeCycleArtifact(
    cycleDir,
    "profile.json",
    profile,
  );

  writeCycleArtifact(
    cycleDir,
    "cursor-before.json",
    cursor,
  );

  let stage =
    "DISCOVERY";

  try {
    const discoverFn =
      dependencies.discoverNewMailboxUidsFn ??
      discoverNewMailboxUids;

    const classifyFn =
      dependencies.acquireAndClassifyFn ??
      acquireAndClassify;

    const reportFn =
      dependencies.runOperationalCollaboratorReportFn ??
      runOperationalCollaboratorReport;

    const surfaceFn =
      dependencies.writeCollaboratorReportSurfaceFn ??
      writeCollaboratorReportSurface;

    const commitFn =
      dependencies.commitMailboxProcessingCursorFn ??
      commitMailboxProcessingCursor;

    const discovery =
      await discoverFn(
        cursor,
      );

    writeCycleArtifact(
      cycleDir,
      "discovery.json",
      discovery,
    );

    stage =
      "CLASSIFICATION";

    const classificationDependencies =
      {};

    if (mode === "COMMIT") {
      classificationDependencies.observeEvidenceRecordsFn =
        evidenceRecords => {
          const candidateRegistry =
            buildCollaboratorRegistryCandidates({
              mailEvidence:
                evidenceRecords,

              ownAddresses:
                walltechOwnAddresses(),
            });

          persistCollaboratorRegistry({
            registryPath:
              absoluteRegistryPath,

            incomingRegistry:
              candidateRegistry,
          });
        };
    }

    const classification =
      await classifyFn(
        discovery,
        profile.collaboratorDirectory,
        classificationDependencies,
      );

    writeCycleArtifact(
      cycleDir,
      "classification.json",
      classification,
    );

    const processingUids =
      processingEligibleUidsForClassification(
        classification,
      );

    const deferredEligibleUids =
      classification.eligibleUids
        .filter(
          uid =>
            !processingUids.includes(
              uid,
            ),
        )
        .sort(
          (a, b) =>
            a - b,
        );

    let reportOutcome = {
      attempted:
        false,

      success:
        false,

      reportId:
        null,

      surface:
        null,

      error:
        null,
    };

    stage =
      "REPORT";

    if (
      processingUids.length > 0
    ) {
      const reportId =
        deterministicReportId(
          profile,
          cursor,
          processingUids,
        );

      const operationalInput =
        buildOperationalRunInput(
          profile,
          reportId,
          processingUids,
        );

      writeCycleArtifact(
        cycleDir,
        "operational-run-input.json",
        operationalInput,
      );

      reportOutcome.attempted =
        true;

      reportOutcome.reportId =
        reportId;

      try {
        const report =
          await reportFn(
            operationalInput,
          );

        /*
         * Processing is not successful until the
         * durable human/machine report surface exists.
         */
        const surface =
          await surfaceFn(
            report,
            reportOutputDir,
          );

        reportOutcome = {
          attempted:
            true,

          success:
            true,

          reportId:
            report.reportId,

          surface,

          error:
            null,
        };

        writeCycleArtifact(
          cycleDir,
          "report-result.json",
          report,
        );

        writeCycleArtifact(
          cycleDir,
          "report-surface.json",
          surface,
        );
      } catch (error) {
        reportOutcome = {
          attempted:
            true,

          success:
            false,

          reportId,
          surface:
            null,

          error:
            String(
              error?.message ??
              error,
            ),
        };

        writeCycleArtifact(
          cycleDir,
          "report-error.json",
          reportOutcome,
        );
      }
    }

    stage =
      "RECEIPT";

    const receipt =
      buildProcessingReceipt(
        classification,
        processingUids,
        reportOutcome,
      );

    writeCycleArtifact(
      cycleDir,
      "processing-receipt.json",
      receipt,
    );

    stage =
      "PROPOSAL";

    const proposal =
      buildMailboxCursorAdvanceProposal(
        cursor,
        discovery,
        classification,
        receipt,
      );

    writeCycleArtifact(
      cycleDir,
      "cursor-advance-proposal.json",
      proposal,
    );

    stage =
      "COMMIT";

    let commitResult;

    if (
      mode === "DRY_RUN"
    ) {
      commitResult = {
        status:
          "DRY_RUN",

        commitId:
          null,

        auditDir:
          null,

        boundaryBefore:
          cursor.boundaryUid,

        boundaryAfter:
          cursor.boundaryUid,

        proposedBoundary:
          proposal.targetBoundaryUid,

        proposalDecision:
          proposal.decision,

        cursorMutation:
          false,
      };
    } else {
      commitResult =
        await commitFn({
          cursorPath,
          discovery,
          classification,
          receipt,
          proposal,

          auditRoot:
            "runtime/audit/mailbox-cursor",
        });
    }

    writeCycleArtifact(
      cycleDir,
      "cursor-commit-result.json",
      commitResult,
    );

    stage =
      "FINALIZE";

    const result = {
      cycleVersion:
        "1.0",

      cycleType:
        "COLLABORATOR_AUTO_CYCLE",

      cyclePolicy:
        "DISCOVER_CLASSIFY_SAFE_PREFIX_REPORT_THEN_CURSOR_COMMIT_V1",

      cycleId,

      mode,

      profileId:
        profile.profileId,

      accountLookup:
        profile.accountLookup,

      mailboxPath:
        profile.mailboxPath,

      startedAt,

      finishedAt:
        new Date().toISOString(),

      discoveredUids:
        [...discovery.newUids],

      eligibleUids:
        [...classification.eligibleUids],

      processingUids:
        [...processingUids],

      deferredEligibleUids,

      nonEligibleItems:
        classification.nonEligibleItems,

      report:
        reportOutcome,

      receiptStatus:
        receipt.status,

      proposalDecision:
        proposal.decision,

      proposalReason:
        proposal.reason,

      proposedBoundary:
        proposal.targetBoundaryUid,

      cursorBoundaryBefore:
        commitResult.boundaryBefore,

      cursorBoundaryAfter:
        commitResult.boundaryAfter,

      cursorMutation:
        commitResult.cursorMutation,

      status:
        summarizeStatus({
          discovery,
          processingUids,
          reportOutcome,
          proposal,

          /*
           * DRY_RUN intentionally reports the
           * actual boundary as unchanged.
           */
          commitResult,
        }),

      businessInference:
        false,

      automaticBusinessBinding:
        false,

      automaticOpportunityHint:
        false,

      crmMutation:
        false,

      mailboxMutation:
        false,
    };

    writeCycleArtifact(
      cycleDir,
      "result.json",
      result,
    );

    writeLatestCycle(
      absoluteAuditRoot,
      result,
    );

    return result;
  } catch (error) {
    const failure = {
      cycleVersion:
        "1.0",

      cycleType:
        "COLLABORATOR_AUTO_CYCLE_FAILURE",

      cycleId,

      mode,

      profileId:
        profile.profileId,

      accountLookup:
        profile.accountLookup,

      mailboxPath:
        profile.mailboxPath,

      stage,

      startedAt,

      failedAt:
        new Date().toISOString(),

      error:
        String(
          error?.message ??
          error,
        ),

      businessInference:
        false,

      crmMutation:
        false,
    };

    try {
      writeCycleArtifact(
        cycleDir,
        "failure.json",
        failure,
      );

      writeLatestCycle(
        absoluteAuditRoot,
        failure,
      );
    } catch {
      // Preserve original failure.
    }

    throw error;
  }
}

async function main() {
  const profilePath =
    process.argv[2];

  const cursorPath =
    process.argv[3];

  const mode =
    (
      process.argv[4] ??
      "COMMIT"
    )
      .trim()
      .toUpperCase();

  if (
    !profilePath ||
    !cursorPath
  ) {
    console.error(
      "Usage: node src/reporting/run-collaborator-auto-cycle.js <profile.json> <cursor.json> [COMMIT|DRY_RUN]",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const result =
      await runCollaboratorAutoCycle({
        profilePath,
        cursorPath,
        mode,
      });

    console.log(
      "COLLABORATOR AUTO CYCLE: PASS",
    );

    console.log(
      `MODE: ${result.mode}`,
    );

    console.log(
      `STATUS: ${result.status}`,
    );

    console.log(
      `DISCOVERED UIDS: ${
        result.discoveredUids.length
          ? result.discoveredUids.join(",")
          : "NONE"
      }`,
    );

    console.log(
      `ELIGIBLE UIDS: ${
        result.eligibleUids.length
          ? result.eligibleUids.join(",")
          : "NONE"
      }`,
    );

    console.log(
      `PROCESSING UIDS: ${
        result.processingUids.length
          ? result.processingUids.join(",")
          : "NONE"
      }`,
    );

    console.log(
      `DEFERRED UIDS: ${
        result.deferredEligibleUids.length
          ? result.deferredEligibleUids.join(",")
          : "NONE"
      }`,
    );

    console.log(
      `REPORT: ${
        result.report.success
          ? result.report.reportId
          : result.report.attempted
            ? "FAILED"
            : "NOT_REQUIRED"
      }`,
    );

    console.log(
      `CURSOR: ${result.cursorBoundaryBefore} -> ${result.cursorBoundaryAfter}`,
    );

    console.log(
      `PROPOSED CURSOR: ${result.proposedBoundary}`,
    );

    console.log(
      `CURSOR MUTATION: ${
        result.cursorMutation
          ? "YES"
          : "NONE"
      }`,
    );

    console.log(
      "AUTOMATIC BUSINESS BINDING: NONE",
    );

    console.log(
      "AUTOMATIC OPPORTUNITY HINT: NONE",
    );

    console.log(
      "CRM MUTATION: NONE",
    );

    console.log(
      "MAILBOX MUTATION: NONE",
    );
  } catch (error) {
    console.error(
      "COLLABORATOR AUTO CYCLE: FAIL",
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
  validateCoordinates,
  deterministicReportId,
  buildOperationalRunInput,
  buildProcessingReceipt,
  summarizeStatus,
  runCollaboratorAutoCycle,
};
