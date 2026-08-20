const fs =
  require("node:fs");

const path =
  require("node:path");

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

const CYCLE_SCHEMA =
  "src/mail/communication-cycle.schema.json";


function invariant(
  condition,
  message
) {
  if (!condition) {
    throw new Error(message);
  }
}


function loadJson(
  filePath
) {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        process.cwd(),
        filePath
      ),
      "utf8"
    )
  );
}


function clone(
  value
) {
  return JSON.parse(
    JSON.stringify(value)
  );
}


function cycleValidator() {
  const schema =
    loadJson(
      CYCLE_SCHEMA
    );

  const ajv =
    new Ajv2020({
      allErrors: true,
      strict: true,
    });

  addFormats(ajv);

  return ajv.compile(
    schema
  );
}


function isoOrNull(
  value,
  label
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const time =
    Date.parse(value);

  invariant(
    Number.isFinite(time),
    `${label} INVALID DATE-TIME`
  );

  return new Date(
    time
  ).toISOString();
}


function latestIso(
  left,
  right
) {
  if (!left) {
    return right || null;
  }

  if (!right) {
    return left;
  }

  return (
    Date.parse(left) >=
    Date.parse(right)
      ? left
      : right
  );
}


function uniqueStrings(
  ...lists
) {
  return [
    ...new Set(
      lists
        .flat()
        .filter(
          value =>
            typeof value ===
              "string" &&
            value.trim()
        )
    ),
  ];
}


/*
 * This mapping is management-state normalization only.
 *
 * It does NOT change commercial status,
 * blocker, next action, pricing, fee,
 * opportunity meaning or counterpart meaning.
 *
 * Ambiguous/terminal statuses fail closed.
 */
function managementStateForStatus(
  status
) {
  const states = {
    NEW: [
      "START",
      "IN_CONTROL",
    ],

    ACTIVE: [
      "CHANGE",
      "IN_CONTROL",
    ],

    WAITING_ON_WALLTECH: [
      "CHANGE",
      "ACTION_REQUIRED",
    ],

    WAITING_ON_COUNTERPARTY: [
      "CHANGE",
      "WAITING_EXTERNAL",
    ],

    WAITING_ON_SUPPLIER: [
      "CHANGE",
      "WAITING_EXTERNAL",
    ],

    BLOCKED: [
      "CHANGE",
      "BLOCKED",
    ],

    QUALIFIED: [
      "CHANGE",
      "IN_CONTROL",
    ],

    QUOTATION: [
      "CHANGE",
      "IN_CONTROL",
    ],

    NEGOTIATION: [
      "CHANGE",
      "IN_CONTROL",
    ],

    CONTRACT: [
      "CHANGE",
      "IN_CONTROL",
    ],

    EXCHANGE: [
      "CHANGE",
      "IN_CONTROL",
    ],
  };

  const state =
    states[status];

  invariant(
    state,
    `STATUS NOT SAFE FOR LINK_EXISTING MATERIALIZATION: ${status}`
  );

  return {
    lifecyclePhase:
      state[0],

    controlStatus:
      state[1],
  };
}


function appendAssignmentEvidence(
  currentEvidence,
  queueItem
) {
  const assignment =
    queueItem.assignment;

  const decision =
    assignment.maxDecision;

  const evidence =
    Array.isArray(
      currentEvidence
    )
      ? clone(
          currentEvidence
        )
      : [];

  const exists =
    evidence.some(
      item =>
        item &&
        item.assignmentId ===
          assignment.assignmentId &&
        item.evidenceId ===
          assignment.evidenceId
    );

  if (!exists) {
    evidence.push({
      evidenceType:
        "MAIL_EVIDENCE",

      evidenceId:
        assignment.evidenceId,

      assignmentId:
        assignment.assignmentId,

      relationship:
        "MAX_CONFIRMED_LINK_EXISTING",

      decisionSource:
        decision.decisionSource,

      decidedBy:
        decision.decidedBy,

      decidedAt:
        decision.decidedAt,
    });
  }

  return evidence;
}


function materializeConfirmedLinkExisting({
  cycle,
  queueItem,
}) {
  invariant(
    cycle &&
    typeof cycle ===
      "object",
    "COMMUNICATION CYCLE REQUIRED"
  );

  invariant(
    queueItem &&
    typeof queueItem ===
      "object",
    "QUEUE ITEM REQUIRED"
  );

  const assignment =
    queueItem.assignment;

  invariant(
    assignment &&
    assignment.assignmentType ===
      "CYCLE_ASSIGNMENT",
    "CYCLE ASSIGNMENT REQUIRED"
  );

  const decision =
    assignment.maxDecision;

  invariant(
    decision &&
    decision.state ===
      "CONFIRMED",
    "CONFIRMED MAX DECISION REQUIRED"
  );

  invariant(
    decision.classification ===
      "LINK_EXISTING",
    "LINK_EXISTING REQUIRED"
  );

  invariant(
    decision.decisionSource ===
      "MAX_EXPLICIT",
    "MAX_EXPLICIT DECISION REQUIRED"
  );

  invariant(
    decision.decidedBy ===
      "MAX",
    "MAX AUTHORITY REQUIRED"
  );

  invariant(
    decision.cycleId &&
    decision.cycleId ===
      cycle.dealId,
    "ASSIGNMENT / CYCLE ID MISMATCH"
  );

  const summary =
    queueItem.evidenceSummary;

  invariant(
    summary &&
    summary.evidenceId ===
      assignment.evidenceId,
    "ASSIGNMENT / EVIDENCE SUMMARY MISMATCH"
  );

  const evidenceAt =
    isoOrNull(
      summary.messageDate,
      "EVIDENCE MESSAGE DATE"
    );

  invariant(
    evidenceAt,
    "EVIDENCE MESSAGE DATE REQUIRED"
  );

  const decidedAt =
    isoOrNull(
      decision.decidedAt,
      "MAX DECIDED AT"
    );

  invariant(
    decidedAt,
    "MAX DECIDED AT REQUIRED"
  );

  const result =
    clone(cycle);

  /*
   * If the cycle already has a lifecycle,
   * do not overwrite it at this boundary.
   *
   * If it is legacy, normalize only from
   * its already-authoritative commercial status.
   */
  if (
    !result.lifecyclePhase
  ) {
    const management =
      managementStateForStatus(
        result.status
      );

    result.lifecyclePhase =
      management.lifecyclePhase;

    result.controlStatus =
      management.controlStatus;
  }

  invariant(
    result.lifecyclePhase,
    "MANAGEMENT LIFECYCLE REQUIRED"
  );

  invariant(
    result.controlStatus,
    "MANAGEMENT CONTROL STATUS REQUIRED"
  );

  /*
   * Preserve commercial content.
   * Materialize only management/evidence linkage.
   */
  result.stopOutcome =
    result.stopOutcome ??
    null;

  result.stopReason =
    result.stopReason ??
    null;

  result.startedAt =
    result.startedAt ??
    null;

  result.lastEvidenceAt =
    latestIso(
      isoOrNull(
        result.lastEvidenceAt,
        "CURRENT LAST EVIDENCE AT"
      ),
      evidenceAt
    );

  result.lastActionAt =
    result.lastActionAt ??
    null;

  result.nextActionDueAt =
    result.nextActionDueAt ??
    null;

  result.updatedAt =
    latestIso(
      isoOrNull(
        result.updatedAt,
        "CURRENT UPDATED AT"
      ),
      decidedAt
    );

  result.stoppedAt =
    result.stoppedAt ??
    null;

  result.invoiceIssuedAt =
    result.invoiceIssuedAt ??
    null;

  result.paymentReceivedAt =
    result.paymentReceivedAt ??
    null;

  /*
   * Never clear an existing collaborator/report
   * assignment merely because this particular
   * evidence item has NONE.
   */
  result.assignedCollaboratorIds =
    uniqueStrings(
      result
        .assignedCollaboratorIds ||
        [],
      decision
        .assignedCollaboratorIds ||
        []
    );

  result.reportRecipientCollaboratorIds =
    uniqueStrings(
      result
        .reportRecipientCollaboratorIds ||
        [],
      decision
        .reportRecipientCollaboratorIds ||
        []
    );

  result.evidence =
    appendAssignmentEvidence(
      result.evidence,
      queueItem
    );

  const validate =
    cycleValidator();

  invariant(
    validate(result),
    `MATERIALIZED COMMUNICATION CYCLE INVALID: ${JSON.stringify(
      validate.errors
    )}`
  );

  return result;
}


function writeAtomic(
  outputPath,
  value
) {
  const absolute =
    path.resolve(
      process.cwd(),
      outputPath
    );

  fs.mkdirSync(
    path.dirname(
      absolute
    ),
    {
      recursive: true,
    }
  );

  const temp =
    `${absolute}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    {
      mode: 0o600,
    }
  );

  fs.renameSync(
    temp,
    absolute
  );
}


function main() {
  const command =
    process.argv[2];

  const cyclePath =
    process.argv[3];

  const queueItemPath =
    process.argv[4];

  const outputPath =
    process.argv[5] ||
    null;

  invariant(
    [
      "preview",
      "commit",
    ].includes(command),
    "COMMAND MUST BE preview OR commit"
  );

  invariant(
    cyclePath &&
    queueItemPath,
    "CYCLE PATH AND QUEUE ITEM PATH REQUIRED"
  );

  const cycle =
    loadJson(
      cyclePath
    );

  const queueItem =
    loadJson(
      queueItemPath
    );

  const result =
    materializeConfirmedLinkExisting({
      cycle,
      queueItem,
    });

  if (
    command ===
    "preview"
  ) {
    process.stdout.write(
      JSON.stringify(
        result,
        null,
        2
      ) + "\n"
    );

    return;
  }

  invariant(
    outputPath,
    "OUTPUT PATH REQUIRED FOR commit"
  );

  writeAtomic(
    outputPath,
    result
  );

  console.log(
    `COMMUNICATION CYCLE MATERIALIZED: ${result.dealId}`
  );

  console.log(
    `OUTPUT: ${path.resolve(
      process.cwd(),
      outputPath
    )}`
  );
}


if (
  require.main ===
  module
) {
  try {
    main();
  } catch (error) {
    console.error(
      "CYCLE MATERIALIZATION ERROR:",
      error.message
    );

    process.exit(1);
  }
}


module.exports = {
  materializeConfirmedLinkExisting,
  managementStateForStatus,
  writeAtomic,
};
