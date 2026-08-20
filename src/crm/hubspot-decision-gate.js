const fs = require("node:fs");
const path = require("node:path");

const HUBSPOT_BASE =
  "https://api.hubapi.com";

const PIPELINE_ID =
  "walltech_decision_fee_control";

const NEEDS_REVIEW_STAGE_ID =
  "wt_needs_review";

const MAX_OWNER_ID =
  "92056746";

function invariant(
  condition,
  message,
) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadJson(
  filePath,
) {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        process.cwd(),
        filePath,
      ),
      "utf8",
    ),
  );
}

function clip(
  value,
  maxLength,
) {
  const text =
    String(value ?? "");

  if (
    text.length <=
    maxLength
  ) {
    return text;
  }

  return (
    text.slice(
      0,
      maxLength - 1,
    ) +
    "…"
  );
}

function externalSenderLabel(
  evidenceSummary,
) {
  const sender =
    (
      evidenceSummary
        ?.externalFrom ||
      []
    )[0] ||
    null;

  if (!sender) {
    return "External terminal";
  }

  if (
    sender.name &&
    sender.address
  ) {
    return (
      `${sender.name} <${sender.address}>`
    );
  }

  return (
    sender.address ||
    sender.name ||
    "External terminal"
  );
}

function buildTicketProposal(
  queueItem,
) {
  invariant(
    queueItem &&
    typeof queueItem ===
      "object",
    "QUEUE ITEM REQUIRED",
  );

  const assignment =
    queueItem.assignment;

  const evidence =
    queueItem.evidenceSummary;

  invariant(
    assignment
      ?.assignmentType ===
      "CYCLE_ASSIGNMENT",
    "CYCLE ASSIGNMENT REQUIRED",
  );

  /*
   * Critical authority gate:
   *
   * Only unresolved PENDING_MAX
   * items can enter HubSpot Needs Review.
   *
   * A confirmed or ignored business
   * decision must never be recreated as
   * a review ticket.
   */
  invariant(
    assignment
      ?.maxDecision
      ?.state ===
      "PENDING_MAX",
    "ONLY PENDING_MAX CAN ENTER HUBSPOT REVIEW",
  );

  invariant(
    assignment
      .maxDecision
      .classification ===
      null,
    "PENDING_MAX CLASSIFICATION MUST BE NULL",
  );

  invariant(
    assignment
      .maxDecision
      .cycleId ===
      null,
    "PENDING_MAX CYCLE ID MUST BE NULL",
  );

  invariant(
    assignment
      .maxDecision
      .assignedCollaboratorIds
      .length === 0,
    "PENDING_MAX CANNOT HAVE COLLABORATOR ASSIGNMENT",
  );

  invariant(
    assignment
      .maxDecision
      .reportRecipientCollaboratorIds
      .length === 0,
    "PENDING_MAX CANNOT HAVE REPORT RECIPIENT",
  );

  invariant(
    assignment
      .systemProposal
      .canMutateBusinessState ===
      false,
    "BUSINESS MUTATION GUARD REQUIRED",
  );

  invariant(
    evidence &&
    evidence.evidenceId ===
      assignment.evidenceId,
    "EVIDENCE / ASSIGNMENT MISMATCH",
  );

  const sender =
    externalSenderLabel(
      evidence,
    );

  const subject =
    clip(
      `[${assignment.assignmentId}] ${sender} — ${evidence.subject || "Nuova evidenza mail"}`,
      240,
    );

  const source =
    evidence.source ||
    {};

  const description = [
    "WALLTECH — HUMAN DECISION GATE",
    "",
    "STATE: PENDING_MAX",
    "",
    `Assignment ID: ${assignment.assignmentId}`,
    `Evidence ID: ${assignment.evidenceId}`,
    "",
    `From: ${sender}`,
    `Subject: ${evidence.subject || "-"}`,
    "",
    `Source Account: ${source.accountKey || "-"}`,
    `Mailbox: ${source.mailboxPath || "-"}`,
    `UIDVALIDITY: ${source.uidValidity || "-"}`,
    `UID: ${source.uid || "-"}`,
    "",
    `Message Date: ${evidence.messageDate || "-"}`,
    `Attachments: ${evidence.attachmentCount ?? 0}`,
    "",
    "SYSTEM PROPOSAL ONLY:",
    `Classification Candidate: ${assignment.systemProposal.classificationCandidate}`,
    `Candidate Cycles: ${
      assignment.systemProposal.candidateCycleIds.length
        ? assignment.systemProposal.candidateCycleIds.join(", ")
        : "NONE"
    }`,
    "",
    "MAX DECISION REQUIRED:",
    "- NEW_CYCLE",
    "- LINK_EXISTING",
    "- NON_DEAL_RELEVANT",
    "- IGNORE",
    "",
    "NO DEAL CREATION AUTHORIZED.",
    "NO COLLABORATOR ASSIGNMENT AUTHORIZED.",
    "NO REPORT RECIPIENT AUTHORIZED.",
    "NO COMMERCIAL STATE MUTATION AUTHORIZED.",
  ].join("\n");

  return {
    assignmentId:
      assignment.assignmentId,

    evidenceId:
      assignment.evidenceId,

    objectType:
      "tickets",

    operation:
      "CREATE_OR_REUSE_REVIEW_TICKET",

    properties: {
      hs_pipeline:
        PIPELINE_ID,

      hs_pipeline_stage:
        NEEDS_REVIEW_STAGE_ID,

      hubspot_owner_id:
        MAX_OWNER_ID,

      subject,

      content:
        description,

      walltech_participation_status:
        "PENDING_REVIEW",

      walltech_binding_status:
        "UNCONFIRMED",
    },

    authority: {
      sourceState:
        "PENDING_MAX",

      decisionAuthority:
        "MAX",

      businessMutation:
        false,

      dealCreation:
        false,

      collaboratorAssignment:
        false,

      reportRecipientSelection:
        false,

      emailSend:
        false,
    },
  };
}

function token() {
  const value =
    process.env
      .HUBSPOT_PRIVATE_APP_TOKEN;

  invariant(
    value,
    "HUBSPOT_PRIVATE_APP_TOKEN MISSING",
  );

  return value;
}

async function hubspotRequest(
  pathname,
  {
    method = "GET",
    body = null,
  } = {},
) {
  const response =
    await fetch(
      `${HUBSPOT_BASE}${pathname}`,
      {
        method,

        headers: {
          Authorization:
            `Bearer ${token()}`,

          Accept:
            "application/json",

          ...(body
            ? {
                "Content-Type":
                  "application/json",
              }
            : {}),
        },

        ...(body
          ? {
              body:
                JSON.stringify(
                  body,
                ),
            }
          : {}),
      },
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `HUBSPOT ${method} ${pathname} HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  return (
    text
      ? JSON.parse(text)
      : {}
  );
}

async function verifyConfig() {
  const result =
    await hubspotRequest(
      "/crm/v3/pipelines/tickets",
    );

  const pipeline =
    (result.results || [])
      .find(
        item =>
          item.id ===
          PIPELINE_ID,
      );

  invariant(
    pipeline,
    `PIPELINE NOT FOUND: ${PIPELINE_ID}`,
  );

  const stage =
    (pipeline.stages || [])
      .find(
        item =>
          item.id ===
          NEEDS_REVIEW_STAGE_ID,
      );

  invariant(
    stage,
    `STAGE NOT FOUND: ${NEEDS_REVIEW_STAGE_ID}`,
  );

  return {
    pipelineId:
      pipeline.id,

    pipelineLabel:
      pipeline.label,

    stageId:
      stage.id,

    stageLabel:
      stage.label,
  };
}

async function findExistingTicket(
  assignmentId,
) {
  const result =
    await hubspotRequest(
      "/crm/v3/objects/tickets/search",
      {
        method:
          "POST",

        body: {
          query:
            assignmentId,

          limit:
            10,

          properties: [
            "subject",
            "hs_pipeline",
            "hs_pipeline_stage",
            "walltech_participation_status",
            "walltech_binding_status",
          ],
        },
      },
    );

  return (
    (result.results || [])
      .find(
        ticket =>
          ticket
            .properties
            ?.subject
            ?.includes(
              `[${assignmentId}]`,
            ),
      ) ||
    null
  );
}

async function createOrReuseTicket(
  queueItem,
  {
    maxApproved = false,
  } = {},
) {
  invariant(
    maxApproved === true,
    "MAX EXPLICIT APPROVAL REQUIRED FOR HUBSPOT MUTATION",
  );

  const proposal =
    buildTicketProposal(
      queueItem,
    );

  await verifyConfig();

  const existing =
    await findExistingTicket(
      proposal.assignmentId,
    );

  if (existing) {
    return {
      action:
        "REUSED_EXISTING",

      ticketId:
        existing.id,

      assignmentId:
        proposal.assignmentId,

      mutation:
        false,
    };
  }

  const created =
    await hubspotRequest(
      "/crm/v3/objects/tickets",
      {
        method:
          "POST",

        body: {
          properties:
            proposal.properties,
        },
      },
    );

  return {
    action:
      "CREATED",

    ticketId:
      created.id,

    assignmentId:
      proposal.assignmentId,

    mutation:
      true,
  };
}

function renderPreview(
  proposal,
) {
  return [
    "HUBSPOT HUMAN DECISION GATE PREVIEW",
    "",
    `Assignment: ${proposal.assignmentId}`,
    `Evidence: ${proposal.evidenceId}`,
    "",
    `Pipeline: ${proposal.properties.hs_pipeline}`,
    `Stage: ${proposal.properties.hs_pipeline_stage}`,
    `Owner: ${proposal.properties.hubspot_owner_id}`,
    "",
    `Ticket Subject: ${proposal.properties.subject}`,
    "",
    "Ticket Content:",
    "----------------",
    proposal.properties.content,
    "----------------",
    "",
    `Participation Status: ${proposal.properties.walltech_participation_status}`,
    `Binding Status: ${proposal.properties.walltech_binding_status}`,
    "",
    "SYSTEM CAN CREATE DEAL: NO",
    "SYSTEM CAN ASSIGN COLLABORATOR: NO",
    "SYSTEM CAN SELECT REPORT RECIPIENT: NO",
    "SYSTEM CAN DECIDE BUSINESS CLASSIFICATION: NO",
    "EMAIL SEND: NO",
  ].join("\n");
}

async function main() {
  const command =
    process.argv[2];

  if (
    command ===
    "verify-config"
  ) {
    const result =
      await verifyConfig();

    console.log(
      "HUBSPOT DECISION GATE CONFIG: PASS",
    );

    console.log(
      `PIPELINE: ${result.pipelineId} | ${result.pipelineLabel}`,
    );

    console.log(
      `STAGE: ${result.stageId} | ${result.stageLabel}`,
    );

    console.log(
      "HUBSPOT MUTATION: NONE",
    );

    return;
  }

  if (
    command ===
    "preview"
  ) {
    const inputPath =
      process.argv[3];

    invariant(
      inputPath,
      "PREVIEW INPUT FILE REQUIRED",
    );

    const queueItem =
      loadJson(
        inputPath,
      );

    const proposal =
      buildTicketProposal(
        queueItem,
      );

    console.log(
      renderPreview(
        proposal,
      ),
    );

    console.log("");
    console.log(
      "PREVIEW: PASS",
    );

    console.log(
      "HUBSPOT MUTATION: NONE",
    );

    return;
  }

  if (
    command ===
    "create"
  ) {
    const inputPath =
      process.argv[3];

    const approval =
      process.argv[4];

    invariant(
      inputPath,
      "CREATE INPUT FILE REQUIRED",
    );

    invariant(
      approval ===
      "--max-approved",
      "CREATE REQUIRES --max-approved",
    );

    const queueItem =
      loadJson(
        inputPath,
      );

    const result =
      await createOrReuseTicket(
        queueItem,
        {
          maxApproved:
            true,
        },
      );

    console.log(
      "HUBSPOT DECISION GATE WRITE: PASS",
    );

    console.log(
      `ACTION: ${result.action}`,
    );

    console.log(
      `TICKET ID: ${result.ticketId}`,
    );

    console.log(
      `ASSIGNMENT: ${result.assignmentId}`,
    );

    return;
  }

  console.error(
    [
      "Usage:",
      "  node src/crm/hubspot-decision-gate.js verify-config",
      "  node src/crm/hubspot-decision-gate.js preview <queue-item.json>",
      "  node src/crm/hubspot-decision-gate.js create <queue-item.json> --max-approved",
    ].join("\n"),
  );

  process.exit(2);
}

if (
  require.main === module
) {
  main().catch(
    error => {
      console.error(
        error.message,
      );

      process.exit(1);
    },
  );
}

module.exports = {
  buildTicketProposal,
  createOrReuseTicket,
  verifyConfig,
  renderPreview,
};
