const fs = require("node:fs");
const path = require("node:path");

const Ajv2020 =
  require("ajv/dist/2020").default;

const addFormats =
  require("ajv-formats");

const cursorSchema =
  require(
    "./mailbox-processing-cursor.schema.json"
  );

const discoverySchema =
  require(
    "./mailbox-new-uid-discovery.schema.json"
  );

const classificationSchema =
  require(
    "../reporting/collaborator-discovered-uid-eligibility.schema.json"
  );

const receiptSchema =
  require(
    "../reporting/collaborator-eligible-processing-receipt.schema.json"
  );

const proposalSchema =
  require(
    "./mailbox-cursor-advance-proposal.schema.json"
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

function validateAgainstSchema(
  schema,
  value,
  label,
) {
  const ajv =
    new Ajv2020({
      strict: true,
      allErrors: true,
    });

  addFormats(ajv);

  const validate =
    ajv.compile(
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

function sortedUnique(
  values,
) {
  return [
    ...new Set(
      values,
    ),
  ].sort(
    (a, b) =>
      a - b,
  );
}

function sameUidSet(
  left,
  right,
) {
  return (
    JSON.stringify(
      sortedUnique(left),
    ) ===
    JSON.stringify(
      sortedUnique(right),
    )
  );
}

function validateClassificationCoverage(
  discovery,
  classification,
) {
  /*
   * A classification is allowed to partition the
   * discovery set, never replace it with another
   * same-sized UID set.
   *
   * This guard prevents count-equivalent forged or
   * corrupted classifications from allowing the
   * cursor to skip an actually discovered message.
   */

  if (
    discovery.newUidCount !==
    discovery.newUids.length
  ) {
    throw new Error(
      "DISCOVERY UID COUNT DOES NOT MATCH UID SET",
    );
  }

  const expectedStatus =
    discovery.newUids.length > 0
      ? "NEW_UIDS_AVAILABLE"
      : "NO_NEW_MESSAGES";

  if (
    discovery.status !==
    expectedStatus
  ) {
    throw new Error(
      "DISCOVERY STATUS DOES NOT MATCH UID SET",
    );
  }

  if (
    classification.counts.eligible !==
    classification.eligibleUids.length
  ) {
    throw new Error(
      "CLASSIFICATION ELIGIBLE COUNT MISMATCH",
    );
  }

  if (
    classification.counts.nonEligible !==
    classification.nonEligibleItems.length
  ) {
    throw new Error(
      "CLASSIFICATION NON-ELIGIBLE COUNT MISMATCH",
    );
  }

  if (
    classification.counts.discovered !==
    classification.counts.eligible +
    classification.counts.nonEligible
  ) {
    throw new Error(
      "CLASSIFICATION COUNT CONSERVATION FAILED",
    );
  }

  const eligibleItemUids =
    classification.eligibleItems
      .map(
        item =>
          item.uid,
      );

  if (
    !sameUidSet(
      eligibleItemUids,
      classification.eligibleUids,
    ) ||
    eligibleItemUids.length !==
    classification.eligibleUids.length
  ) {
    throw new Error(
      "CLASSIFICATION ELIGIBLE ITEMS DO NOT MATCH ELIGIBLE UID SET",
    );
  }

  const nonEligibleUids =
    classification.nonEligibleItems
      .map(
        item =>
          item.uid,
      );

  if (
    sortedUnique(
      nonEligibleUids,
    ).length !==
    nonEligibleUids.length
  ) {
    throw new Error(
      "CLASSIFICATION DUPLICATE NON-ELIGIBLE UID",
    );
  }

  const eligibleSet =
    new Set(
      classification.eligibleUids,
    );

  for (
    const uid
    of nonEligibleUids
  ) {
    if (
      eligibleSet.has(uid)
    ) {
      throw new Error(
        `CLASSIFICATION UID BOTH ELIGIBLE AND NON-ELIGIBLE: ${uid}`,
      );
    }
  }

  const classifiedUids =
    sortedUnique([
      ...classification.eligibleUids,
      ...nonEligibleUids,
    ]);

  if (
    !sameUidSet(
      classifiedUids,
      discovery.newUids,
    ) ||
    classifiedUids.length !==
    discovery.newUids.length
  ) {
    throw new Error(
      `CLASSIFICATION UID COVERAGE MISMATCH: discovery=${sortedUnique(
        discovery.newUids,
      ).join(",")} classification=${classifiedUids.join(",")}`,
    );
  }

  if (
    classification.counts.discovered !==
    discovery.newUidCount
  ) {
    throw new Error(
      "CLASSIFICATION/DISCOVERY COUNT MISMATCH",
    );
  }

  return true;
}

function firstReviewBlockerUid(
  classification,
) {
  const reviewUids =
    classification.nonEligibleItems
      .filter(
        item =>
          item.disposition ===
            "REVIEW_REQUIRED_AMBIGUOUS" ||
          item.disposition ===
            "REVIEW_REQUIRED_DIRECTION_AMBIGUOUS",
      )
      .map(
        item =>
          item.uid,
      )
      .sort(
        (a, b) =>
          a - b,
      );

  return (
    reviewUids.length > 0
      ? reviewUids[0]
      : null
  );
}

function processingEligibleUidsForClassification(
  classification,
) {
  const firstBlocker =
    firstReviewBlockerUid(
      classification,
    );

  return [
    ...classification.eligibleUids,
  ]
    .filter(
      uid =>
        firstBlocker === null ||
        uid < firstBlocker,
    )
    .sort(
      (a, b) =>
        a - b,
    );
}

function validateReceiptSemantics(
  classification,
  receipt,
) {
  if (
    receipt.accountLookup !==
      classification.accountLookup ||
    receipt.mailboxPath !==
      classification.mailboxPath ||
    receipt.sourceDiscoveryAt !==
      classification.sourceDiscoveryAt
  ) {
    throw new Error(
      "PROCESSING RECEIPT SOURCE MISMATCH",
    );
  }

  const expectedProcessingUids =
    processingEligibleUidsForClassification(
      classification,
    );

  /*
   * If a REVIEW_REQUIRED item exists, eligible
   * messages after that blocker must be deferred
   * to a later discovery cycle.
   *
   * Processing them now would create a report
   * that the still-blocked cursor would rediscover.
   */
  if (
    !sameUidSet(
      receipt.eligibleUids,
      expectedProcessingUids,
    )
  ) {
    throw new Error(
      `PROCESSING RECEIPT ELIGIBLE UID SET MISMATCH: expected ${expectedProcessingUids.join(",")} got ${sortedUnique(
        receipt.eligibleUids,
      ).join(",")}`,
    );
  }

  const successful =
    new Set(
      receipt.successfulUids,
    );

  const failed =
    new Set(
      receipt.failedUids,
    );

  for (
    const uid
    of successful
  ) {
    if (failed.has(uid)) {
      throw new Error(
        `PROCESSING RECEIPT UID BOTH SUCCESS AND FAILED: ${uid}`,
      );
    }
  }

  const covered =
    sortedUnique([
      ...receipt.successfulUids,
      ...receipt.failedUids,
    ]);

  if (
    !sameUidSet(
      covered,
      receipt.eligibleUids,
    )
  ) {
    throw new Error(
      "PROCESSING RECEIPT DOES NOT COVER ALL ELIGIBLE UIDS",
    );
  }

  const eligibleCount =
    receipt.eligibleUids.length;

  const successCount =
    receipt.successfulUids.length;

  const failureCount =
    receipt.failedUids.length;

  if (
    eligibleCount === 0
  ) {
    if (
      receipt.status !==
      "NOT_REQUIRED" ||
      receipt.reportId !==
      null
    ) {
      throw new Error(
        "NO-ELIGIBLE RECEIPT MUST BE NOT_REQUIRED WITH NULL REPORT",
      );
    }

    return;
  }

  if (
    failureCount === 0
  ) {
    if (
      receipt.status !==
      "SUCCESS" ||
      successCount !==
      eligibleCount ||
      typeof receipt.reportId !==
        "string" ||
      receipt.reportId.trim() === ""
    ) {
      throw new Error(
        "SUCCESS RECEIPT SEMANTICS INVALID",
      );
    }

    return;
  }

  if (
    successCount === 0
  ) {
    if (
      receipt.status !==
      "FAILED"
    ) {
      throw new Error(
        "FAILED RECEIPT SEMANTICS INVALID",
      );
    }

    return;
  }

  if (
    receipt.status !==
    "PARTIAL_FAILURE"
  ) {
    throw new Error(
      "PARTIAL FAILURE RECEIPT SEMANTICS INVALID",
    );
  }
}

function buildMailboxCursorAdvanceProposal(
  cursor,
  discovery,
  classification,
  receipt,
  builtAt =
    new Date().toISOString(),
) {
  validateAgainstSchema(
    cursorSchema,
    cursor,
    "MAILBOX PROCESSING CURSOR",
  );

  validateAgainstSchema(
    discoverySchema,
    discovery,
    "MAILBOX NEW UID DISCOVERY",
  );

  validateAgainstSchema(
    classificationSchema,
    classification,
    "COLLABORATOR UID ELIGIBILITY",
  );

  validateAgainstSchema(
    receiptSchema,
    receipt,
    "ELIGIBLE PROCESSING RECEIPT",
  );

  if (
    discovery.accountLookup !==
      cursor.accountLookup ||
    discovery.mailboxPath !==
      cursor.mailboxPath
  ) {
    throw new Error(
      "DISCOVERY/CURSOR MAILBOX COORDINATE MISMATCH",
    );
  }

  if (
    discovery.cursorUidValidity !==
      cursor.uidValidity ||
    discovery.observedUidValidity !==
      cursor.uidValidity
  ) {
    throw new Error(
      "DISCOVERY/CURSOR UIDVALIDITY MISMATCH",
    );
  }

  if (
    discovery.cursorBoundaryUid !==
    cursor.boundaryUid
  ) {
    throw new Error(
      "DISCOVERY/CURSOR BOUNDARY MISMATCH",
    );
  }

  if (
    classification.accountLookup !==
      discovery.accountLookup ||
    classification.mailboxPath !==
      discovery.mailboxPath ||
    classification.sourceDiscoveryAt !==
      discovery.discoveredAt
  ) {
    throw new Error(
      "CLASSIFICATION/DISCOVERY SOURCE MISMATCH",
    );
  }

  validateClassificationCoverage(
    discovery,
    classification,
  );

  validateReceiptSemantics(
    classification,
    receipt,
  );

  const successfulEligibleUids =
    sortedUnique(
      receipt.successfulUids,
    );

  const terminalNonEligibleUids =
    sortedUnique(
      classification.nonEligibleItems
        .filter(
          item =>
            item.disposition ===
              "NOT_IN_CONFIRMED_DIRECTORY" ||
            item.disposition ===
              "NOT_COLLABORATOR_SELF",
        )
        .map(
          item =>
            item.uid,
        ),
    );

  const blockingItems = [];

  for (
    const uid
    of receipt.failedUids
  ) {
    blockingItems.push({
      uid,
      reason:
        "ELIGIBLE_PROCESSING_FAILED",
    });
  }

  for (
    const item
    of classification.nonEligibleItems
  ) {
    if (
      item.disposition ===
      "REVIEW_REQUIRED_AMBIGUOUS"
    ) {
      blockingItems.push({
        uid:
          item.uid,

        reason:
          "REVIEW_REQUIRED_AMBIGUOUS",
      });
    }

    if (
      item.disposition ===
      "REVIEW_REQUIRED_DIRECTION_AMBIGUOUS"
    ) {
      blockingItems.push({
        uid:
          item.uid,

        reason:
          "REVIEW_REQUIRED_DIRECTION_AMBIGUOUS",
      });
    }
  }

  blockingItems.sort(
    (a, b) =>
      a.uid - b.uid ||
      a.reason.localeCompare(
        b.reason,
      ),
  );

  const snapshotUpperUid =
    discovery.observedUidNext - 1;

  if (
    snapshotUpperUid <
    cursor.boundaryUid
  ) {
    throw new Error(
      "SNAPSHOT UPPER UID PRECEDES CURRENT CURSOR",
    );
  }

  let targetBoundaryUid;
  let reason;

  if (
    blockingItems.length > 0
  ) {
    const firstBlockUid =
      blockingItems[0].uid;

    targetBoundaryUid =
      firstBlockUid - 1;

    if (
      targetBoundaryUid <
      cursor.boundaryUid
    ) {
      throw new Error(
        "BLOCKER PRECEDES CURRENT CURSOR",
      );
    }

    if (
      targetBoundaryUid >
      cursor.boundaryUid
    ) {
      reason =
        "ADVANCE_TO_BEFORE_BLOCKER";
    } else {
      reason =
        "BLOCKED_AT_NEXT_UID";
    }
  } else {
    targetBoundaryUid =
      snapshotUpperUid;

    if (
      targetBoundaryUid >
      cursor.boundaryUid
    ) {
      reason =
        "SNAPSHOT_FULLY_HANDLED";
    } else {
      reason =
        "NO_NEW_UID_SPACE";
    }
  }

  const decision =
    targetBoundaryUid >
    cursor.boundaryUid
      ? "ADVANCE_ALLOWED"
      : "NO_ADVANCE";

  const targetBoundaryKind =
    decision ===
    "ADVANCE_ALLOWED"
      ? "PROCESSED_SUCCESS"
      : cursor.boundaryKind;

  const proposal = {
    proposalVersion:
      "1.0",

    proposalType:
      "MAILBOX_CURSOR_ADVANCE_PROPOSAL",

    proposalPolicy:
      "CONTIGUOUS_HANDLED_SNAPSHOT_FAIL_CLOSED_V1",

    accountLookup:
      cursor.accountLookup,

    mailboxPath:
      cursor.mailboxPath,

    uidValidity:
      cursor.uidValidity,

    currentBoundaryUid:
      cursor.boundaryUid,

    currentBoundaryKind:
      cursor.boundaryKind,

    observedUidNext:
      discovery.observedUidNext,

    observedHighestModseq:
      discovery.observedHighestModseq,

    snapshotUpperUid,

    successfulEligibleUids,

    terminalNonEligibleUids,

    blockingItems,

    targetBoundaryUid,

    targetBoundaryKind,

    decision,

    reason,

    cursorMutation:
      false,

    builtAt,
  };

  validateAgainstSchema(
    proposalSchema,
    proposal,
    "MAILBOX CURSOR ADVANCE PROPOSAL",
  );

  return proposal;
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

  const outputPath =
    process.argv[6] ??
    null;

  if (
    !cursorPath ||
    !discoveryPath ||
    !classificationPath ||
    !receiptPath
  ) {
    console.error(
      "Usage: node src/mail/build-mailbox-cursor-advance-proposal.js <cursor.json> <discovery.json> <classification.json> <processing-receipt.json> [output.json]",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const cursor =
      loadJson(
        cursorPath,
        "MAILBOX PROCESSING CURSOR",
      );

    const discovery =
      loadJson(
        discoveryPath,
        "MAILBOX NEW UID DISCOVERY",
      );

    const classification =
      loadJson(
        classificationPath,
        "COLLABORATOR UID ELIGIBILITY",
      );

    const receipt =
      loadJson(
        receiptPath,
        "ELIGIBLE PROCESSING RECEIPT",
      );

    const proposal =
      buildMailboxCursorAdvanceProposal(
        cursor,
        discovery,
        classification,
        receipt,
      );

    const json =
      `${JSON.stringify(
        proposal,
        null,
        2,
      )}\n`;

    if (outputPath) {
      const absoluteOutput =
        path.resolve(
          process.cwd(),
          outputPath,
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
      "MAILBOX CURSOR ADVANCE PROPOSAL: PASS",
    );

    console.error(
      `CURRENT BOUNDARY: ${proposal.currentBoundaryUid}`,
    );

    console.error(
      `TARGET BOUNDARY: ${proposal.targetBoundaryUid}`,
    );

    console.error(
      `DECISION: ${proposal.decision}`,
    );

    console.error(
      `REASON: ${proposal.reason}`,
    );

    console.error(
      `BLOCKERS: ${
        proposal.blockingItems.length
          ? proposal.blockingItems
              .map(
                item =>
                  `${item.uid}:${item.reason}`,
              )
              .join(",")
          : "NONE"
      }`,
    );

    console.error(
      "CURSOR MUTATION: NONE",
    );
  } catch (error) {
    console.error(
      "MAILBOX CURSOR ADVANCE PROPOSAL: FAIL",
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
  validateClassificationCoverage,
  firstReviewBlockerUid,
  processingEligibleUidsForClassification,
  validateReceiptSemantics,
  buildMailboxCursorAdvanceProposal,
};
