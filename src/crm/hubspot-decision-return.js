const fs =
  require("node:fs");

const path =
  require("node:path");

const AjvModule =
  require("ajv/dist/2020");

const Ajv =
  AjvModule.default ||
  AjvModule;

const addFormatsModule =
  require("ajv-formats");

const addFormats =
  addFormatsModule.default ||
  addFormatsModule;

const HUBSPOT_BASE =
  "https://api.hubapi.com";

const PIPELINE_ID =
  "walltech_decision_fee_control";

const CONFIRMED_STAGE =
  "wt_confirmed";

const REJECTED_STAGE =
  "wt_rejected";

const ASSIGNMENT_SCHEMA =
  path.resolve(
    process.cwd(),
    "src/mail/cycle-assignment.schema.json"
  );

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadJson(filePath) {
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

function assignmentValidator() {
  const schema =
    loadJson(
      ASSIGNMENT_SCHEMA
    );

  const ajv =
    new Ajv({
      allErrors:
        true,

      strict:
        true,
    });

  addFormats(ajv);

  return ajv.compile(
    schema
  );
}

function token() {
  const value =
    process.env
      .HUBSPOT_PRIVATE_APP_TOKEN;

  invariant(
    value,
    "HUBSPOT_PRIVATE_APP_TOKEN MISSING"
  );

  return value;
}

function parseIdList(value) {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      String(value)
        .split(
          /[,;\n\r]+/
        )
        .map(
          x =>
            x.trim()
        )
        .filter(Boolean)
    ),
  ];
}

function clean(value) {
  const result =
    String(
      value ?? ""
    ).trim();

  return result ||
    null;
}

function buildDecisionReturn(
  queueItem,
  ticket
) {
  invariant(
    queueItem
      ?.assignment
      ?.maxDecision
      ?.state ===
      "PENDING_MAX",
    "ONLY PENDING_MAX CAN BE CONFIRMED"
  );

  const p =
    ticket.properties ||
    {};

  invariant(
    p.hs_pipeline ===
      PIPELINE_ID,
    "TICKET PIPELINE INVALID"
  );

  const classification =
    clean(
      p.walltech_decision_classification
    );

  invariant(
    [
      "NEW_CYCLE",
      "LINK_EXISTING",
      "NON_DEAL_RELEVANT",
      "IGNORE",
    ].includes(
      classification
    ),
    "VALID MAX CLASSIFICATION REQUIRED"
  );

  const cycleId =
    clean(
      p.walltech_cycle_id
    );

  const cycleName =
    clean(
      p.walltech_cycle_name
    );

  const assigned =
    parseIdList(
      p.walltech_assigned_collaborator_ids
    );

  const reportRecipients =
    parseIdList(
      p.walltech_report_recipient_collaborator_ids
    );

  const priority =
    clean(
      p.walltech_cycle_priority
    );

  const nextAction =
    clean(
      p.walltech_cycle_next_action
    );

  const nextActionDueAt =
    clean(
      p.walltech_cycle_next_action_due_at
    );

  const decidedAt =
    clean(
      p.walltech_decision_at
    );

  const decidedBy =
    clean(
      p.walltech_decision_by
    )?.toUpperCase() ||
    null;

  invariant(
    decidedBy === "MAX",
    "DECISION BY MUST RESOLVE TO MAX"
  );

  invariant(
    decidedAt,
    "DECISION AT REQUIRED"
  );

  if (
    classification ===
    "IGNORE"
  ) {
    invariant(
      p.hs_pipeline_stage ===
        REJECTED_STAGE,
      "IGNORE REQUIRES REJECTED STAGE"
    );

    invariant(
      cycleId === null,
      "IGNORE CANNOT HAVE CYCLE ID"
    );

    invariant(
      assigned.length === 0 &&
      reportRecipients.length === 0,
      "IGNORE CANNOT HAVE ASSIGNMENTS"
    );
  } else {
    invariant(
      p.hs_pipeline_stage ===
        CONFIRMED_STAGE,
      "CONFIRMED DECISION REQUIRES CONFIRMED STAGE"
    );

    invariant(
      cycleId,
      "CYCLE ID REQUIRED"
    );

    invariant(
      p.walltech_binding_status ===
        "USER_CONFIRMED",
      "USER_CONFIRMED BINDING REQUIRED"
    );

    invariant(
      p.walltech_participation_status ===
        "ACTIVE",
      "ACTIVE PARTICIPATION REQUIRED"
    );
  }

  if (
    classification ===
    "NEW_CYCLE"
  ) {
    invariant(
      cycleName,
      "NEW_CYCLE REQUIRES CYCLE NAME"
    );

    invariant(
      [
        "LOW",
        "MEDIUM",
        "HIGH",
        "CRITICAL",
      ].includes(priority),
      "NEW_CYCLE REQUIRES VALID PRIORITY"
    );

    invariant(
      nextAction,
      "NEW_CYCLE REQUIRES NEXT ACTION"
    );

    invariant(
      nextActionDueAt,
      "NEW_CYCLE REQUIRES NEXT ACTION DUE AT"
    );
  }

  const assignment =
    JSON.parse(
      JSON.stringify(
        queueItem.assignment
      )
    );

  assignment.maxDecision = {
    state:
      "CONFIRMED",

    classification,

    cycleId:
      classification ===
      "IGNORE"
        ? null
        : cycleId,

    assignedCollaboratorIds:
      classification ===
      "IGNORE"
        ? []
        : assigned,

    reportRecipientCollaboratorIds:
      classification ===
      "IGNORE"
        ? []
        : reportRecipients,

    decisionSource:
      "MAX_EXPLICIT",

    decidedBy:
      "MAX",

    decidedAt,
  };

  const validate =
    assignmentValidator();

  invariant(
    validate(
      assignment
    ),
    `CONFIRMED ASSIGNMENT INVALID: ${JSON.stringify(validate.errors)}`
  );

  return {
    decisionReturnVersion:
      "1.0",

    decisionReturnType:
      "HUBSPOT_MAX_DECISION",

    hubspotTicketId:
      String(
        ticket.id
      ),

    assignmentId:
      assignment.assignmentId,

    evidenceId:
      assignment.evidenceId,

    assignment,

    cycleDirective: {
      cycleId:
        classification ===
        "IGNORE"
          ? null
          : cycleId,

      cycleName,

      priority,

      nextAction,

      nextActionDueAt,
    },

    decisionNote:
      clean(
        p.walltech_decision_note
      ),

    authority: {
      decisionAuthority:
        "MAX",

      decisionSource:
        "MAX_EXPLICIT",

      businessMutationAuthorized:
        true,

      dealCreationAuthorized:
        false,

      emailSendAuthorized:
        false,
    },
  };
}

async function fetchTicket(
  ticketId
) {
  const properties = [
    "hs_pipeline",
    "hs_pipeline_stage",
    "walltech_participation_status",
    "walltech_binding_status",
    "walltech_decision_at",
    "walltech_decision_by",
    "walltech_decision_note",
    "walltech_decision_classification",
    "walltech_cycle_id",
    "walltech_cycle_name",
    "walltech_assigned_collaborator_ids",
    "walltech_report_recipient_collaborator_ids",
    "walltech_cycle_priority",
    "walltech_cycle_next_action",
    "walltech_cycle_next_action_due_at",
  ].join(",");

  const response =
    await fetch(
      `${HUBSPOT_BASE}/crm/v3/objects/tickets/${ticketId}?properties=${properties}`,
      {
        headers: {
          Authorization:
            `Bearer ${token()}`,

          Accept:
            "application/json",
        },
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `HUBSPOT TICKET READ HTTP ${response.status}: ${text.slice(0, 500)}`
    );
  }

  return JSON.parse(
    text
  );
}

function writeAtomic(
  target,
  value
) {
  const absolute =
    path.resolve(
      process.cwd(),
      target
    );

  fs.mkdirSync(
    path.dirname(
      absolute
    ),
    {
      recursive:
        true,
    }
  );

  const temp =
    `${absolute}.tmp-${process.pid}`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    {
      mode:
        0o600,
    }
  );

  fs.renameSync(
    temp,
    absolute
  );
}

function applyToQueue(
  queue,
  decisionReturn
) {
  invariant(
    queue
      ?.queueType ===
      "WALLTECH_CYCLE_ASSIGNMENT_QUEUE",
    "QUEUE INVALID"
  );

  const index =
    queue.items.findIndex(
      item =>
        item.assignment
          .assignmentId ===
        decisionReturn
          .assignmentId
    );

  invariant(
    index >= 0,
    "ASSIGNMENT NOT FOUND IN QUEUE"
  );

  invariant(
    queue.items[index]
      .assignment
      .maxDecision
      .state ===
      "PENDING_MAX",
    "QUEUE ITEM ALREADY DECIDED"
  );

  queue.items[index]
    .assignment =
    decisionReturn.assignment;

  queue.updatedAt =
    new Date().toISOString();

  return queue;
}

function render(
  result
) {
  return [
    "HUBSPOT DECISION RETURN",
    "",
    `Ticket: ${result.hubspotTicketId}`,
    `Assignment: ${result.assignmentId}`,
    `Evidence: ${result.evidenceId}`,
    "",
    `Classification: ${result.assignment.maxDecision.classification}`,
    `Cycle ID: ${result.assignment.maxDecision.cycleId || "-"}`,
    `Assigned collaborators: ${result.assignment.maxDecision.assignedCollaboratorIds.join(", ") || "NONE"}`,
    `Report recipients: ${result.assignment.maxDecision.reportRecipientCollaboratorIds.join(", ") || "NONE"}`,
    "",
    `Cycle name: ${result.cycleDirective.cycleName || "-"}`,
    `Priority: ${result.cycleDirective.priority || "-"}`,
    `Next action: ${result.cycleDirective.nextAction || "-"}`,
    `Next action due: ${result.cycleDirective.nextActionDueAt || "-"}`,
    "",
    "DEAL CREATION: NO",
    "EMAIL SEND: NO",
  ].join("\n");
}

async function main() {
  const command =
    process.argv[2];

  if (
    command ===
    "fixture"
  ) {
    const queueItem =
      loadJson(
        process.argv[3]
      );

    const ticket =
      loadJson(
        process.argv[4]
      );

    const result =
      buildDecisionReturn(
        queueItem,
        ticket
      );

    console.log(
      render(result)
    );

    console.log("");
    console.log(
      "DECISION RETURN FIXTURE: PASS"
    );

    return;
  }

  if (
    command ===
    "read"
  ) {
    const queueItem =
      loadJson(
        process.argv[3]
      );

    const ticketId =
      process.argv[4];

    invariant(
      ticketId,
      "TICKET ID REQUIRED"
    );

    const ticket =
      await fetchTicket(
        ticketId
      );

    const result =
      buildDecisionReturn(
        queueItem,
        ticket
      );

    console.log(
      render(result)
    );

    console.log("");
    console.log(
      "HUBSPOT READ: PASS"
    );

    console.log(
      "LOCAL MUTATION: NONE"
    );

    return;
  }

  if (
    command ===
    "consume"
  ) {
    const queuePath =
      process.argv[3];

    const ticketId =
      process.argv[4];

    invariant(
      queuePath &&
      ticketId,
      "QUEUE PATH AND TICKET ID REQUIRED"
    );

    const queue =
      loadJson(
        queuePath
      );

    const pending =
      queue.items.find(
        item =>
          item.assignment
            .maxDecision
            .state ===
          "PENDING_MAX" &&
          item.assignment
            .assignmentId
      );

    invariant(
      pending,
      "NO PENDING ASSIGNMENT FOUND"
    );

    const ticket =
      await fetchTicket(
        ticketId
      );

    const result =
      buildDecisionReturn(
        pending,
        ticket
      );

    const updated =
      applyToQueue(
        queue,
        result
      );

    writeAtomic(
      queuePath,
      updated
    );

    console.log(
      render(result)
    );

    console.log("");
    console.log(
      "AUTHORITATIVE QUEUE UPDATE: PASS"
    );

    console.log(
      "HUBSPOT MUTATION: NONE"
    );

    return;
  }

  throw new Error(
    [
      "Usage:",
      "  fixture <queue-item.json> <ticket.json>",
      "  read <queue-item.json> <ticketId>",
      "  consume <queue.json> <ticketId>",
    ].join("\n")
  );
}

if (
  require.main ===
  module
) {
  main().catch(
    error => {
      console.error(
        "DECISION RETURN ERROR:",
        error.message
      );

      process.exit(1);
    }
  );
}

module.exports = {
  buildDecisionReturn,
  applyToQueue,
  parseIdList,
};
