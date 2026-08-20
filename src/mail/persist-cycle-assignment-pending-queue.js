const fs = require("node:fs");
const path = require("node:path");

const AjvModule =
  require("ajv/dist/2020");
const Ajv =
  AjvModule.default || AjvModule;

const addFormatsModule =
  require("ajv-formats");
const addFormats =
  addFormatsModule.default ||
  addFormatsModule;

const ASSIGNMENT_SCHEMA =
  path.resolve(
    process.cwd(),
    "src/mail/cycle-assignment.schema.json",
  );

function loadJson(filePath) {
  return JSON.parse(
    fs.readFileSync(
      filePath,
      "utf8",
    ),
  );
}

function normalizeAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function assignmentValidator() {
  const schema =
    loadJson(
      ASSIGNMENT_SCHEMA,
    );

  const ajv =
    new Ajv({
      allErrors: true,
      strict: true,
    });

  addFormats(ajv);

  return ajv.compile(schema);
}

function buildPendingCycleAssignment({
  evidence,
  ownAddresses = [],
}) {
  if (
    !evidence ||
    evidence.evidenceType !==
      "MAIL_EVIDENCE"
  ) {
    throw new Error(
      "MAIL_EVIDENCE REQUIRED",
    );
  }

  const own =
    new Set(
      ownAddresses
        .map(normalizeAddress)
        .filter(Boolean),
    );

  const externalFrom =
    (evidence.participants?.from || [])
      .map(item => ({
        name:
          item.name ?? null,

        address:
          normalizeAddress(
            item.address,
          ),
      }))
      .filter(
        item =>
          item.address &&
          !own.has(
            item.address,
          ),
      );

  /*
   * No external sender means this evidence
   * is not an inbound external decision item.
   */
  if (
    externalFrom.length === 0
  ) {
    return null;
  }

  const assignment = {
    assignmentVersion:
      "1.0",

    assignmentType:
      "CYCLE_ASSIGNMENT",

    assignmentId:
      `CA-${evidence.evidenceId.slice(3)}`,

    evidenceId:
      evidence.evidenceId,

    systemProposal: {
      proposalOnly:
        true,

      /*
       * The system is deliberately not
       * allowed to infer NEW DEAL vs
       * EXISTING CYCLE at this boundary.
       */
      classificationCandidate:
        "UNKNOWN",

      candidateCycleIds:
        [],

      canMutateBusinessState:
        false,
    },

    maxDecision: {
      state:
        "PENDING_MAX",

      classification:
        null,

      cycleId:
        null,

      assignedCollaboratorIds:
        [],

      reportRecipientCollaboratorIds:
        [],

      decisionSource:
        null,

      decidedBy:
        null,

      decidedAt:
        null,
    },
  };

  const validate =
    assignmentValidator();

  if (
    !validate(
      assignment,
    )
  ) {
    throw new Error(
      `CYCLE ASSIGNMENT INVALID: ${JSON.stringify(
        validate.errors,
      )}`,
    );
  }

  return {
    assignment,

    evidenceSummary: {
      evidenceId:
        evidence.evidenceId,

      source: {
        accountKey:
          evidence.source.accountKey,

        mailboxUser:
          evidence.source.mailboxUser,

        mailboxPath:
          evidence.source.mailboxPath,

        uidValidity:
          evidence.source.uidValidity,

        uid:
          evidence.source.uid,
      },

      messageDate:
        evidence.identity.date ??
        evidence.identity.internalDate ??
        null,

      subject:
        evidence.identity.subject ??
        null,

      externalFrom,

      to:
        evidence.participants?.to ||
        [],

      cc:
        evidence.participants?.cc ||
        [],

      attachmentCount:
        evidence.attachmentCount,

      attachments:
        (evidence.attachments || [])
          .map(item => ({
            filename:
              item.filename ?? null,

            mimeType:
              item.mimeType ?? null,

            sizeBytes:
              item.sizeBytes,
          })),
    },
  };
}

function writeAtomically(
  target,
  value,
) {
  const dir =
    path.dirname(target);

  fs.mkdirSync(
    dir,
    {
      recursive: true,
    },
  );

  const temp =
    `${target}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2,
    ) + "\n",
    {
      mode: 0o600,
    },
  );

  fs.renameSync(
    temp,
    target,
  );
}

function persistCycleAssignmentPendingQueue({
  queuePath,
  evidenceRecords,
  ownAddresses = [],
}) {
  if (
    !Array.isArray(
      evidenceRecords,
    )
  ) {
    throw new Error(
      "EVIDENCE RECORDS MUST BE AN ARRAY",
    );
  }

  const absolute =
    path.resolve(
      process.cwd(),
      queuePath,
    );

  let existing = {
    queueVersion:
      "1.0",

    queueType:
      "WALLTECH_CYCLE_ASSIGNMENT_QUEUE",

    items:
      [],
  };

  if (
    fs.existsSync(
      absolute,
    )
  ) {
    existing =
      loadJson(
        absolute,
      );

    if (
      existing.queueType !==
        "WALLTECH_CYCLE_ASSIGNMENT_QUEUE" ||
      !Array.isArray(
        existing.items,
      )
    ) {
      throw new Error(
        "EXISTING CYCLE ASSIGNMENT QUEUE INVALID",
      );
    }
  }

  const byId =
    new Map(
      existing.items.map(
        item => [
          item.assignment.assignmentId,
          item,
        ],
      ),
    );

  let added = 0;

  for (
    const evidence
    of evidenceRecords
  ) {
    const item =
      buildPendingCycleAssignment({
        evidence,
        ownAddresses,
      });

    if (!item) {
      continue;
    }

    const id =
      item.assignment.assignmentId;

    /*
     * Existing state wins.
     * This is critical: a later acquisition
     * must never overwrite a Max decision.
     */
    if (
      byId.has(id)
    ) {
      continue;
    }

    byId.set(
      id,
      item,
    );

    added += 1;
  }

  const queue = {
    queueVersion:
      "1.0",

    queueType:
      "WALLTECH_CYCLE_ASSIGNMENT_QUEUE",

    updatedAt:
      new Date().toISOString(),

    items:
      [...byId.values()]
        .sort(
          (a, b) =>
            String(
              a.evidenceSummary.messageDate ||
              "",
            ).localeCompare(
              String(
                b.evidenceSummary.messageDate ||
                "",
              ),
            ),
        ),
  };

  writeAtomically(
    absolute,
    queue,
  );

  return {
    queuePath:
      absolute,

    total:
      queue.items.length,

    added,

    pending:
      queue.items.filter(
        item =>
          item.assignment
            .maxDecision
            .state ===
          "PENDING_MAX",
      ).length,
  };
}

module.exports = {
  buildPendingCycleAssignment,
  persistCycleAssignmentPendingQueue,
};
