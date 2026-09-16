const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const RECON_DIR =
  path.join(
    ROOT,
    "runtime/state/generic-reconciliation"
  );

const CYCLE_DIR =
  path.join(
    ROOT,
    "runtime/state/communication-cycles"
  );

const REVIEW_FILE =
  path.join(
    RECON_DIR,
    "review-decisions.json"
  );

const RESULT_FILE =
  path.join(
    RECON_DIR,
    "result.json"
  );

const INPUT_FILE =
  path.join(
    RECON_DIR,
    "input.json"
  );

const AUDIT_FILE =
  path.join(
    RECON_DIR,
    "candidate-audit.json"
  );

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function writeAtomic(file, value) {
  const tmp =
    `${file}.tmp-${process.pid}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + "\n",
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );

  fs.renameSync(
    tmp,
    file
  );
}

function findCycleFile(dealId) {
  const files =
    fs.readdirSync(CYCLE_DIR)
      .filter(
        name =>
          name.endsWith(".json")
      )
      .sort();

  for (const name of files) {
    const file =
      path.join(
        CYCLE_DIR,
        name
      );

    const cycle =
      readJson(file);

    if (
      cycle.dealId === dealId
    ) {
      return {
        file,
        cycle,
      };
    }
  }

  return null;
}

function latestIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;

  return (
    new Date(a).getTime() >=
    new Date(b).getTime()
  )
    ? a
    : b;
}

function main() {
  if (!fs.existsSync(REVIEW_FILE)) {
    throw new Error(
      "NO REVIEW DECISION LEDGER"
    );
  }

  const reviews =
    readJson(REVIEW_FILE);

  const result =
    readJson(RESULT_FILE);

  const input =
    readJson(INPUT_FILE);

  const audit =
    fs.existsSync(AUDIT_FILE)
      ? readJson(AUDIT_FILE)
      : [];

  const auditByEvidence =
    new Map(
      (Array.isArray(audit) ? audit : [])
        .filter(
          x =>
            x &&
            x.evidenceId
        )
        .map(
          x => [
            x.evidenceId,
            x,
          ]
        )
    );

  const decisionsByEvidence =
    new Map(
      (result.decisions || [])
        .map(
          d => [
            d.evidenceRef,
            d,
          ]
        )
    );

  const eventsByEvidence =
    new Map(
      (input.events || [])
        .map(
          e => [
            e.evidenceRef,
            e,
          ]
        )
    );

  let applied = 0;
  let alreadyApplied = 0;

  const touched = [];

  for (
    const review
    of Object.values(
      reviews.reviews || {}
    )
  ) {
    const evidenceRef =
      review?.evidenceRef;

    const dealId =
      review?.confirmedOpportunityId;

    if (
      !evidenceRef ||
      !dealId
    ) {
      continue;
    }

    const decision =
      decisionsByEvidence.get(
        evidenceRef
      );

    if (!decision) {
      throw new Error(
        `CONFIRMED REVIEW HAS NO RECONCILIATION DECISION: ${evidenceRef}`
      );
    }

    if (
      decision.reconciliationOutcome !==
      "POSSIBLE_MATCH"
    ) {
      throw new Error(
        `CONFIRMED REVIEW IS NOT POSSIBLE_MATCH: ${evidenceRef}`
      );
    }

    const candidates =
      Array.isArray(
        decision.candidateOpportunityIds
      )
        ? decision.candidateOpportunityIds
        : [];

    if (
      !candidates.includes(dealId)
    ) {
      throw new Error(
        `CONFIRMED DEAL IS NOT A CURRENT CANDIDATE: ${evidenceRef} -> ${dealId}`
      );
    }

    const event =
      eventsByEvidence.get(
        evidenceRef
      );

    if (!event) {
      throw new Error(
        `EVENT NOT FOUND: ${evidenceRef}`
      );
    }

    const hit =
      findCycleFile(dealId);

    if (!hit) {
      throw new Error(
        `COMMUNICATION CYCLE NOT FOUND: ${dealId}`
      );
    }

    const {
      file,
      cycle,
    } = hit;

    cycle.evidence =
      Array.isArray(cycle.evidence)
        ? cycle.evidence
        : [];

    const existing =
      cycle.evidence.find(
        item =>
          item?.evidenceRef ===
            evidenceRef ||
          item?.mailEvidenceId ===
            evidenceRef ||
          item?.evidenceId ===
            evidenceRef
      );

    if (existing) {
      alreadyApplied++;

      console.log(
        `ALREADY APPLIED: ${evidenceRef} -> ${dealId}`
      );

      continue;
    }

    const auditItem =
      auditByEvidence.get(
        evidenceRef
      ) || {};

    cycle.evidence.push({
      evidenceType:
        "MAIL_EVIDENCE",

      evidenceRef,

      mailEvidenceId:
        evidenceRef,

      reconciliationOutcome:
        "LINK_EXISTING",

      bindingSource:
        "USER_CONFIRMED_BINDING",

      confirmedBy:
        "MAX",

      confirmedAt:
        review.updatedAt ||
        new Date().toISOString(),

      subject:
        auditItem.subject ||
        null,

      occurredAt:
        event.occurredAt ||
        null,

      direction:
        event.direction ||
        "UNKNOWN",

      messageId:
        event.messageId ||
        null,

      sourceSha256:
        event.sourceSha256 ||
        null,

      channel:
        event.channel ||
        "EMAIL",

      sourceProvenance:
        event.sourceProvenance ||
        "DIRECT",
    });

    cycle.lastEvidenceAt =
      latestIso(
        cycle.lastEvidenceAt,
        event.occurredAt
      );

    cycle.updatedAt =
      new Date().toISOString();

    writeAtomic(
      file,
      cycle
    );

    applied++;

    touched.push({
      file,
      dealId,
      evidenceRef,
      subject:
        auditItem.subject ||
        null,
    });

    console.log(
      `APPLIED: ${evidenceRef} -> ${dealId}`
    );
  }

  console.log(
    `APPLIED COUNT: ${applied}`
  );

  console.log(
    `ALREADY APPLIED: ${alreadyApplied}`
  );

  console.log(
    "CRM MUTATION: NONE"
  );

  console.log(
    "EMAIL MUTATION: NONE"
  );

  console.log(
    "COMMUNICATION CYCLE MUTATION: USER-CONFIRMED EVIDENCE ONLY"
  );

  console.log(
    "TOUCHED:",
    JSON.stringify(
      touched,
      null,
      2
    )
  );
}

main();
