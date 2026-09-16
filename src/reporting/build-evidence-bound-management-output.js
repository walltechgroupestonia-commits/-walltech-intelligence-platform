const fs = require("node:fs");
const path = require("node:path");

const {
  isDealPipelineEligible,
} = require(
  "./serve-walltech-deal-product.js"
);

const ROOT = process.cwd();

const CYCLE_DIR =
  path.join(
    ROOT,
    "runtime/state/communication-cycles"
  );

const OUTPUT_DIR =
  path.join(
    ROOT,
    "runtime/state/management-output"
  );

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function writeAtomic(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

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

  fs.renameSync(tmp, file);
}

function canonicalEvidence(cycle) {
  return (
    Array.isArray(cycle.evidence)
      ? cycle.evidence
      : []
  )
    .filter(
      item =>
        item &&
        item.evidenceType ===
          "MAIL_EVIDENCE" &&
        (
          item.bindingSource ===
            "USER_CONFIRMED_BINDING" ||
          item.reconciliationOutcome ===
            "LINK_EXISTING"
        )
    )
    .sort(
      (a, b) =>
        String(a.occurredAt || "")
          .localeCompare(
            String(b.occurredAt || "")
          )
    );
}

function buildManagement(cycle) {
  const evidence =
    canonicalEvidence(cycle);

  const latest =
    evidence.length
      ? evidence[evidence.length - 1]
      : null;

  const confirmedEvidenceAt =
    latest?.occurredAt ||
    null;

  const authoritativeCycleAt =
    cycle.lastEvidenceAt ||
    null;

  const authoritativeCycleIsNewer =
    Boolean(
      authoritativeCycleAt &&
      (
        !confirmedEvidenceAt ||
        new Date(
          authoritativeCycleAt
        ).getTime() >
        new Date(
          confirmedEvidenceAt
        ).getTime()
      )
    );

  /*
   * Evidence-bound policy:
   *
   * Latest Update and Last Verified Evidence may be
   * derived directly from confirmed communication metadata.
   *
   * Existing Current Blocker / Next Action are preserved
   * unless semantic evidence proves a replacement.
   *
   * V1 does NOT infer business meaning from a subject line.
   */
  return {
    dealId:
      cycle.dealId,

    dealName:
      cycle.dealName,

    generatedAt:
      new Date().toISOString(),

    latestUpdate:
      latest
        ? {
            occurredAt:
              latest.occurredAt || null,

            direction:
              latest.direction || "UNKNOWN",

            subject:
              latest.subject || null,

            evidenceRef:
              latest.evidenceRef ||
              latest.mailEvidenceId ||
              null,

            source:
              "USER_CONFIRMED_MAIL_EVIDENCE",
          }
        : null,

    currentBlocker:
      cycle.currentBlocker ||
      null,

    currentBlockerBasis:
      cycle.currentBlocker
        ? "EXISTING_AUTHORITATIVE_CYCLE_STATE"
        : "NOT_PROVEN",

    nextAction:
      cycle.nextAction ||
      null,

    nextActionBasis:
      cycle.nextAction
        ? "EXISTING_AUTHORITATIVE_CYCLE_STATE"
        : "NOT_PROVEN",

    lastVerifiedEvidence:
      authoritativeCycleIsNewer
        ? {
            occurredAt:
              authoritativeCycleAt,

            evidenceRef:
              null,

            bindingSource:
              "EXISTING_AUTHORITATIVE_CYCLE_STATE",
          }
        : latest
          ? {
              occurredAt:
                latest.occurredAt || null,

              evidenceRef:
                latest.evidenceRef ||
                latest.mailEvidenceId ||
                null,

              bindingSource:
                latest.bindingSource ||
                null,
            }
          : {
              occurredAt:
                authoritativeCycleAt,

              evidenceRef:
                null,

              bindingSource:
                authoritativeCycleAt
                  ? "EXISTING_AUTHORITATIVE_CYCLE_STATE"
                  : null,
            },

    confirmedMailEvidenceCount:
      evidence.length,

    inferencePolicy:
      "EVIDENCE_BOUND_FAIL_CLOSED_V1",
  };
}

function main() {
  /*
   * Generated product directory:
   * remove stale output from previously included non-Deals.
   */
  fs.rmSync(
    OUTPUT_DIR,
    {
      recursive: true,
      force: true,
    }
  );

  fs.mkdirSync(
    OUTPUT_DIR,
    { recursive: true }
  );

  const files =
    fs.readdirSync(CYCLE_DIR)
      .filter(
        name =>
          name.endsWith(".json")
      )
      .sort();

  let built = 0;

  for (const name of files) {
    const file =
      path.join(
        CYCLE_DIR,
        name
      );

    const cycle =
      readJson(file);

    if (
      !cycle.dealId ||
      !cycle.dealName
    ) {
      continue;
    }

    if (
      !isDealPipelineEligible(
        cycle
      )
    ) {
      continue;
    }

    const management =
      buildManagement(cycle);

    writeAtomic(
      path.join(
        OUTPUT_DIR,
        `${cycle.dealId}.json`
      ),
      management
    );

    built++;
  }

  console.log(
    `MANAGEMENT OUTPUT BUILT: ${built}`
  );

  console.log(
    "POLICY: EVIDENCE_BOUND_FAIL_CLOSED_V1"
  );

  console.log(
    "BUSINESS INFERENCE FROM SUBJECT: NONE"
  );

  console.log(
    "CRM MUTATION: NONE"
  );

  console.log(
    "COMMUNICATION CYCLE MUTATION: NONE"
  );
}

main();
