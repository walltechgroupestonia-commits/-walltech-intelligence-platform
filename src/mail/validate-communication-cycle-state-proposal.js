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

const DEFAULT_SCHEMA =
  "src/mail/communication-cycle-state-proposal.schema.json";

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function loadJson(filePath, label) {
  const absolute =
    path.resolve(
      process.cwd(),
      filePath
    );

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

const proposalPath =
  process.argv[2];

const schemaPath =
  process.argv[3] ||
  DEFAULT_SCHEMA;

if (!proposalPath) {
  console.error(
    "Usage: node src/mail/validate-communication-cycle-state-proposal.js <proposal.json> [schema.json]"
  );

  process.exit(2);
}

const proposal =
  loadJson(
    proposalPath,
    "COMMUNICATION CYCLE STATE PROPOSAL"
  );

const schema =
  loadJson(
    schemaPath,
    "CCSP SCHEMA"
  );

const ajv =
  new Ajv2020({
    allErrors: true,
    strict: true
  });

addFormats(ajv);

let validate;

try {
  validate =
    ajv.compile(schema);
} catch (error) {
  fail(
    `CCSP SCHEMA COMPILE ERROR:\n${error.message}`,
    3
  );
}

if (!validate(proposal)) {
  console.error(
    "COMMUNICATION CYCLE STATE PROPOSAL: INVALID"
  );

  console.error(
    JSON.stringify(
      validate.errors,
      null,
      2
    )
  );

  process.exit(4);
}

/*
 * Snapshot linkage gates.
 */

if (
  proposal.proposedChanges.status.from !==
  proposal.currentCycleSnapshot.status
) {
  fail(
    "CCSP LINK ERROR: status FROM does not match current snapshot",
    5
  );
}

if (
  proposal.proposedChanges.currentBlocker.from !==
  proposal.currentCycleSnapshot.currentBlocker
) {
  fail(
    "CCSP LINK ERROR: blocker FROM does not match current snapshot",
    5
  );
}

if (
  proposal.proposedChanges.nextAction.from !==
  proposal.currentCycleSnapshot.nextAction
) {
  fail(
    "CCSP LINK ERROR: nextAction FROM does not match current snapshot",
    5
  );
}

/*
 * Change-flag consistency gates.
 */

const statusChanged =
  proposal.proposedChanges.status.from !==
  proposal.proposedChanges.status.to;

const blockerChanged =
  proposal.proposedChanges.currentBlocker.from !==
  proposal.proposedChanges.currentBlocker.to;

const nextActionChanged =
  proposal.proposedChanges.nextAction.from !==
  proposal.proposedChanges.nextAction.to;

if (
  proposal.proposedChanges.status.changeProposed !==
  statusChanged
) {
  fail(
    "CCSP SEMANTIC ERROR: status changeProposed mismatch",
    6
  );
}

if (
  proposal.proposedChanges.currentBlocker.changeProposed !==
  blockerChanged
) {
  fail(
    "CCSP SEMANTIC ERROR: blocker changeProposed mismatch",
    6
  );
}

if (
  proposal.proposedChanges.nextAction.changeProposed !==
  nextActionChanged
) {
  fail(
    "CCSP SEMANTIC ERROR: nextAction changeProposed mismatch",
    6
  );
}

/*
 * Evidence coverage gates.
 */

const evidenceTargets =
  new Set(
    proposal.evidenceBasis.map(
      (item) => item.changeTarget
    )
  );

if (
  statusChanged &&
  !evidenceTargets.has("STATUS")
) {
  fail(
    "CCSP EVIDENCE ERROR: proposed status change has no STATUS evidence",
    7
  );
}

if (
  blockerChanged &&
  !evidenceTargets.has("CURRENT_BLOCKER")
) {
  fail(
    "CCSP EVIDENCE ERROR: proposed blocker change has no CURRENT_BLOCKER evidence",
    7
  );
}

if (
  nextActionChanged &&
  !evidenceTargets.has("NEXT_ACTION")
) {
  fail(
    "CCSP EVIDENCE ERROR: proposed next-action change has no NEXT_ACTION evidence",
    7
  );
}

/*
 * Owner gate.
 */

if (
  nextActionChanged &&
  proposal.proposedChanges.nextAction.proposedOwner ===
    "NONE"
) {
  fail(
    "CCSP SEMANTIC ERROR: changed next action cannot have owner NONE",
    8
  );
}

if (
  !nextActionChanged &&
  proposal.proposedChanges.nextAction.proposedOwner !==
    "NONE"
) {
  fail(
    "CCSP SEMANTIC ERROR: unchanged next action must have owner NONE",
    8
  );
}

/*
 * Missing-data set integrity.
 */

const additions =
  new Set(
    proposal.proposedChanges
      .missingCommercialDataAdditions
  );

const removals =
  new Set(
    proposal.proposedChanges
      .missingCommercialDataRemovals
  );

for (const item of additions) {
  if (removals.has(item)) {
    fail(
      `CCSP SEMANTIC ERROR: missing-commercial-data item both added and removed: ${item}`,
      9
    );
  }
}

/*
 * Decision gate safety.
 */

if (
  proposal.decisionGate.approvalRequired !==
  true
) {
  fail(
    "CCSP SAFETY ERROR: approval is not required",
    10
  );
}

if (
  proposal.decisionGate.approvalStatus ===
    "PENDING"
) {
  if (
    proposal.decisionGate.approvedBy !==
      null ||
    proposal.decisionGate.approvedAt !==
      null
  ) {
    fail(
      "CCSP SAFETY ERROR: pending proposal contains approval metadata",
      10
    );
  }
}

if (
  proposal.decisionGate.approvalStatus ===
    "APPROVED"
) {
  if (
    !proposal.decisionGate.approvedBy ||
    !proposal.decisionGate.approvedAt
  ) {
    fail(
      "CCSP SAFETY ERROR: approved proposal lacks approval metadata",
      10
    );
  }
}

if (
  proposal.automaticApplication !==
  false
) {
  fail(
    "CCSP SAFETY ERROR: automatic application enabled",
    11
  );
}

if (
  proposal.cycleMutationPerformed !==
  false
) {
  fail(
    "CCSP SAFETY ERROR: cycle mutation already performed",
    11
  );
}

/*
 * Duplicate evidence gate.
 */

const evidenceKeys =
  proposal.evidenceBasis.map(
    (item) =>
      [
        item.changeTarget,
        item.evidenceType,
        item.evidenceId,
        item.signalType || "NONE",
        item.semanticValue || "NONE",
        item.certainty
      ].join("|")
  );

if (
  new Set(evidenceKeys).size !==
  evidenceKeys.length
) {
  fail(
    "CCSP SEMANTIC ERROR: duplicate evidence basis entries",
    12
  );
}

console.log(
  "COMMUNICATION CYCLE STATE PROPOSAL: VALID"
);

console.log(
  `PROPOSAL ID: ${proposal.communicationCycleStateProposalId}`
);

console.log(
  `DEAL: ${proposal.source.dealId}`
);

console.log(
  `STATUS: ${proposal.proposedChanges.status.from} -> ${proposal.proposedChanges.status.to}`
);

console.log(
  `BLOCKER CHANGE: ${blockerChanged}`
);

console.log(
  `NEXT ACTION CHANGE: ${nextActionChanged}`
);

console.log(
  `NEXT OWNER: ${proposal.proposedChanges.nextAction.proposedOwner}`
);

console.log(
  `EVIDENCE BASIS: ${proposal.evidenceBasis.length}`
);

console.log(
  `APPROVAL REQUIRED: ${proposal.decisionGate.approvalRequired}`
);

console.log(
  `APPROVAL STATUS: ${proposal.decisionGate.approvalStatus}`
);

console.log(
  `AUTOMATIC APPLICATION: ${proposal.automaticApplication}`
);

console.log(
  `CYCLE MUTATION: ${proposal.cycleMutationPerformed}`
);

console.log(
  "CCSP SAFETY GATE: PASS"
);
