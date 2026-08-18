const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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

const CCI_SCHEMA =
  "src/mail/commercial-communication-interpretation.schema.json";

const CCSP_SCHEMA =
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

function compileSchema(schemaPath) {
  const schema =
    loadJson(
      schemaPath,
      "SCHEMA"
    );

  const ajv =
    new Ajv2020({
      allErrors: true,
      strict: true
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
  exitCode = 4
) {
  if (validator(value)) {
    return;
  }

  console.error(
    `${label}: INVALID`
  );

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
    .update(
      String(value),
      "utf8"
    )
    .digest("hex");
}

function signalKey(signal) {
  return [
    signal.signalType,
    signal.subject || "NONE",
    signal.semanticValue,
    signal.certainty
  ].join(":");
}

function signalsByType(
  cci,
  signalType
) {
  return cci.signals.filter(
    (signal) =>
      signal.signalType ===
      signalType
  );
}

function firstProduct(
  cci,
  role
) {
  return (
    cci.productReferences.find(
      (product) =>
        product.role === role
    ) || null
  );
}

function statusForNextActor(
  currentStatus,
  nextActor
) {
  if (
    nextActor ===
    "WALLTECH"
  ) {
    return "WAITING_ON_WALLTECH";
  }

  if (
    nextActor ===
    "COUNTERPARTY"
  ) {
    return "WAITING_ON_COUNTERPARTY";
  }

  return currentStatus;
}

function blockerText(
  cycle,
  cci
) {
  const requested =
    firstProduct(
      cci,
      "REQUESTED"
    );

  const availability =
    cci.signals.find(
      (signal) =>
        signal.signalType ===
          "AVAILABILITY_STATUS" &&
        signal.semanticValue ===
          "UNDER_ALLOCATION"
    );

  const shortage =
    cci.signals.find(
      (signal) =>
        signal.signalType ===
          "SUPPLIER_CONSTRAINT" &&
        signal.semanticValue ===
          "CRITICAL_MEMORY_SHORTAGE"
    );

  const noLeadTime =
    cci.signals.find(
      (signal) =>
        signal.signalType ===
          "LEAD_TIME_STATUS" &&
        signal.semanticValue ===
          "SPECIFIC_LEAD_TIME_NOT_CONFIRMABLE"
    );

  const overYear =
    cci.signals.find(
      (signal) =>
        signal.signalType ===
          "LEAD_TIME_STATUS" &&
        signal.semanticValue ===
          "LEAD_TIME_MAY_EXCEED_ONE_YEAR"
    );

  if (
    !availability &&
    !shortage &&
    !noLeadTime &&
    !overYear
  ) {
    return cycle.currentBlocker;
  }

  const subject =
    requested?.productRef ||
    "requested product";

  const facts = [];

  if (availability) {
    facts.push(
      `${subject} is under allocation`
    );
  }

  if (shortage) {
    facts.push(
      "supplier reports a critical memory shortage"
    );
  }

  if (noLeadTime) {
    facts.push(
      "specific lead time cannot be confirmed"
    );
  }

  if (overYear) {
    facts.push(
      "lead time may exceed one year"
    );
  }

  return (
    facts
      .map(
        (fact, index) =>
          index === 0
            ? fact
            : fact
      )
      .join("; ") + "."
  );
}

function nextActionText(
  cycle,
  cci
) {
  const directive =
    cci.actionDirectives.find(
      (item) =>
        item.actor ===
          "WALLTECH" &&
        item.action ===
          "WORK_WITH_CUSTOMER_ON_REPLACEMENT"
    );

  if (!directive) {
    return cycle.nextAction;
  }

  const target =
    directive.target &&
    directive.target !==
      "REPLACEMENT"
      ? directive.target
      : firstProduct(
          cci,
          "ALTERNATIVE"
        )?.productRef ||
        "supplier-recommended replacement";

  return (
    `Work with the customer on the ` +
    `supplier-recommended replacement ${target}.`
  );
}

function evidenceBasis(
  cci,
  {
    proposedStatusChanged,
    blockerChanged,
    nextActionChanged
  }
) {
  const basis = [];

  const add = (
    changeTarget,
    signal
  ) => {
    basis.push({
      changeTarget,

      evidenceType:
        "COMMERCIAL_COMMUNICATION_INTERPRETATION",

      evidenceId:
        cci.commercialCommunicationInterpretationId,

      signalType:
        signal.signalType,

      semanticValue:
        signal.semanticValue,

      certainty:
        signal.certainty
    });
  };

  if (proposedStatusChanged) {
    for (
      const signal of
      signalsByType(
        cci,
        "ACTION_DIRECTIVE"
      )
    ) {
      add(
        "STATUS",
        signal
      );
    }
  }

  if (blockerChanged) {
    for (const signal of cci.signals) {
      if (
        [
          "SUPPLIER_CONSTRAINT",
          "AVAILABILITY_STATUS",
          "LEAD_TIME_STATUS"
        ].includes(
          signal.signalType
        )
      ) {
        add(
          "CURRENT_BLOCKER",
          signal
        );
      }
    }
  }

  if (nextActionChanged) {
    for (
      const signal of
      signalsByType(
        cci,
        "ACTION_DIRECTIVE"
      )
    ) {
      add(
        "NEXT_ACTION",
        signal
      );
    }
  }

  return basis.sort(
    (a, b) =>
      [
        a.changeTarget,
        a.signalType || "",
        a.semanticValue || "",
        a.certainty
      ]
        .join("|")
        .localeCompare(
          [
            b.changeTarget,
            b.signalType || "",
            b.semanticValue || "",
            b.certainty
          ].join("|")
        )
  );
}

function buildProposal(
  cycle,
  cci
) {
  if (
    cci.commercialStateMutation !==
    "NONE"
  ) {
    fail(
      "CCSP SAFETY ERROR: CCI attempted commercial-state mutation",
      5
    );
  }

  const proposedStatus =
    statusForNextActor(
      cycle.status,
      cci.nextActorDetermination
    );

  const proposedBlocker =
    blockerText(
      cycle,
      cci
    );

  const proposedNextAction =
    nextActionText(
      cycle,
      cci
    );

  const statusChanged =
    proposedStatus !==
    cycle.status;

  const blockerChanged =
    proposedBlocker !==
    cycle.currentBlocker;

  const nextActionChanged =
    proposedNextAction !==
    cycle.nextAction;

  const basis =
    evidenceBasis(
      cci,
      {
        proposedStatusChanged:
          statusChanged,

        blockerChanged,

        nextActionChanged
      }
    );

  if (
    (
      statusChanged ||
      blockerChanged ||
      nextActionChanged
    ) &&
    basis.length === 0
  ) {
    fail(
      "CCSP SAFETY ERROR: proposed change has no evidence basis",
      6
    );
  }

  const fingerprint = [
    "WALLTECH_COMMUNICATION_CYCLE_STATE_PROPOSAL_V1",

    cycle.dealId,

    cci.commercialCommunicationInterpretationId,

    cycle.status,
    proposedStatus,

    cycle.currentBlocker,
    proposedBlocker,

    cycle.nextAction,
    proposedNextAction,

    cci.nextActorDetermination,

    ...basis.map(
      (item) =>
        [
          item.changeTarget,
          item.evidenceType,
          item.evidenceId,
          item.signalType ||
            "NONE",
          item.semanticValue ||
            "NONE",
          item.certainty
        ].join(":")
    ),

    "APPROVAL_REQUIRED",
    "AUTOMATIC_APPLICATION_FALSE",
    "CYCLE_MUTATION_FALSE"
  ].join("\n");

  return {
    proposalVersion:
      "1.0",

    proposalType:
      "COMMUNICATION_CYCLE_STATE_PROPOSAL",

    communicationCycleStateProposalId:
      `CCSP-${sha256Text(
        fingerprint
      )}`,

    proposalPolicy:
      "EVIDENCE_BOUND_NON_MUTATING_V1",

    source: {
      dealId:
        cycle.dealId,

      commercialCommunicationInterpretationId:
        cci.commercialCommunicationInterpretationId,

      mailEvidenceId:
        cci.source.mailEvidenceId,

      responseExpectationEvidenceId:
        cci.source
          .responseExpectationEvidenceId
    },

    currentCycleSnapshot: {
      status:
        cycle.status,

      currentBlocker:
        cycle.currentBlocker,

      nextAction:
        cycle.nextAction
    },

    proposedChanges: {
      status: {
        from:
          cycle.status,

        to:
          proposedStatus,

        changeProposed:
          statusChanged
      },

      currentBlocker: {
        from:
          cycle.currentBlocker,

        to:
          proposedBlocker,

        changeProposed:
          blockerChanged
      },

      nextAction: {
        from:
          cycle.nextAction,

        to:
          proposedNextAction,

        changeProposed:
          nextActionChanged,

        proposedOwner:
          nextActionChanged
            ? cci.nextActorDetermination
            : "NONE"
      },

      /*
       * V1 does not infer changes to missingCommercialData
       * unless explicit data-resolution evidence is available.
       */
      missingCommercialDataAdditions:
        [],

      missingCommercialDataRemovals:
        []
    },

    evidenceBasis:
      basis,

    decisionGate: {
      approvalRequired:
        true,

      approvalStatus:
        "PENDING",

      approvedBy:
        null,

      approvedAt:
        null
    },

    automaticApplication:
      false,

    cycleMutationPerformed:
      false,

    generatedAt:
      new Date().toISOString()
  };
}

function main() {
  const cyclePath =
    process.argv[2];

  const cciPath =
    process.argv[3];

  const outputPath =
    process.argv[4] || null;

  if (
    !cyclePath ||
    !cciPath
  ) {
    console.error(
      "Usage: node src/mail/build-communication-cycle-state-proposal.js <communication-cycle.json> <cci.json> [output.json]"
    );

    process.exit(2);
  }

  const cycle =
    loadJson(
      cyclePath,
      "COMMUNICATION CYCLE"
    );

  const cci =
    loadJson(
      cciPath,
      "COMMERCIAL COMMUNICATION INTERPRETATION"
    );

  validateOrFail(
    compileSchema(
      CYCLE_SCHEMA
    ),
    cycle,
    "COMMUNICATION CYCLE",
    3
  );

  validateOrFail(
    compileSchema(
      CCI_SCHEMA
    ),
    cci,
    "COMMERCIAL COMMUNICATION INTERPRETATION",
    3
  );

  const result =
    buildProposal(
      cycle,
      cci
    );

  validateOrFail(
    compileSchema(
      CCSP_SCHEMA
    ),
    result,
    "COMMUNICATION CYCLE STATE PROPOSAL",
    7
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
        recursive: true
      }
    );

    fs.writeFileSync(
      absolute,
      json
    );
  } else {
    process.stdout.write(
      json
    );
  }

  console.error("");
  console.error(
    "COMMUNICATION CYCLE STATE PROPOSAL: PASS"
  );

  console.error(
    `PROPOSAL: ${result.communicationCycleStateProposalId}`
  );

  console.error(
    `DEAL: ${result.source.dealId}`
  );

  console.error(
    `STATUS: ${result.proposedChanges.status.from} -> ${result.proposedChanges.status.to}`
  );

  console.error(
    `NEXT OWNER: ${result.proposedChanges.nextAction.proposedOwner}`
  );

  console.error(
    `APPROVAL: ${result.decisionGate.approvalStatus}`
  );

  console.error(
    `AUTOMATIC APPLICATION: ${result.automaticApplication}`
  );

  console.error(
    `CYCLE MUTATION: ${result.cycleMutationPerformed}`
  );
}

main();
