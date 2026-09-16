const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  isDealPipelineEligible,
} = require(
  "./serve-walltech-deal-product.js"
);

const ROOT = process.cwd();

const EVIDENCE_DIR =
  path.join(
    ROOT,
    "runtime/state/historical-mail-evidence-2026/canonical"
  );

const CYCLE_DIR =
  path.join(
    ROOT,
    "runtime/state/communication-cycles"
  );

const OUTPUT_DIR =
  path.join(
    ROOT,
    "runtime/state/generic-reconciliation"
  );

function sha(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function writeJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  const tmp =
    `${file}.tmp-${process.pid}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  fs.renameSync(tmp, file);
}

function listJson(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter(name =>
      name.endsWith(".json")
    )
    .sort()
    .map(name =>
      path.join(dir, name)
    );
}

function addresses(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map(item =>
      String(
        item?.address || ""
      )
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
}

function allEvidenceAddresses(evidence) {
  return [
    ...addresses(
      evidence.participants?.from
    ),
    ...addresses(
      evidence.participants?.to
    ),
    ...addresses(
      evidence.participants?.cc
    ),
    ...addresses(
      evidence.participants?.replyTo
    ),
  ];
}


function normalizeMatchToken(token) {
  const value =
    String(token || "")
      .trim()
      .toLowerCase();

  const aliases = {
    advisory: "advisor",
    adviser: "advisor",
    advisors: "advisor",
    advisers: "advisor",
  };

  return aliases[value] || value;
}

function normalizeWords(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9@._-]+/g,
      " "
    )
    .split(/\s+/)
    .filter(Boolean)
    .map(token =>
      normalizeMatchToken(token)
    );
}

const STOP = new Set([
  "walltech",
  "group",
  "deal",
  "opportunity",
  "income",
  "potential",
  "eur",
  "euro",
  "spa",
  "srl",
  "srls",
  "ou",
  "the",
  "and",
  "per",
  "con",
  "del",
  "della",
  "delle",
  "dei",
]);

function significantDealTokens(cycle) {
  return [
    ...new Set(
      normalizeWords(
        `${cycle.dealId || ""} ${cycle.dealName || ""}`
      ).filter(token =>
        token.length >= 4 &&
        !STOP.has(token) &&
        !/^opp-\d+$/i.test(token)
      )
    ),
  ];
}

function cycleEmails(cycle) {
  const text =
    JSON.stringify(cycle).toLowerCase();

  const matches =
    text.match(
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g
    ) || [];

  return [
    ...new Set(matches)
  ];
}

function isInternalWalltechAddress(email) {
  const value =
    String(email || "")
      .trim()
      .toLowerCase();

  return (
    value.endsWith("@walltechgroup.eu") ||
    value === "walltechgroup.estonia@gmail.com"
  );
}

function eventDirection(evidence) {
  const mailbox =
    String(
      evidence.source?.mailboxUser || ""
    )
      .trim()
      .toLowerCase();

  const from =
    addresses(
      evidence.participants?.from
    );

  if (
    mailbox &&
    from.includes(mailbox)
  ) {
    return "OUTBOUND";
  }

  if (mailbox) {
    return "INBOUND";
  }

  return "UNKNOWN";
}

function collaborator(evidence) {
  const mailbox =
    String(
      evidence.source?.mailboxUser || ""
    )
      .trim()
      .toLowerCase();

  const candidates =
    [
      ...addresses(
        evidence.participants?.from
      ),
      ...addresses(
        evidence.participants?.to
      ),
    ].filter(address =>
      address !== mailbox
    );

  const email =
    candidates[0] ||
    mailbox ||
    "unknown@walltech.local";

  return {
    collaboratorId:
      `EMAIL-${sha(email)}`,
    collaboratorName:
      email,
  };
}

function existingBindingForEvidence(
  evidence,
  cycles
) {
  for (const cycle of cycles) {
    const items =
      Array.isArray(cycle.evidence)
        ? cycle.evidence
        : [];

    for (const item of items) {
      const refs = [
        item?.evidenceRef,
        item?.evidenceId,
        item?.mailEvidenceId,
      ].filter(Boolean);

      if (
        refs.includes(
          evidence.evidenceId
        )
      ) {
        return cycle.dealId;
      }
    }
  }

  return null;
}

function candidateDeals(
  evidence,
  cycles
) {
  const subject =
    String(
      evidence.identity?.subject || ""
    );

  const subjectWords =
    new Set(
      normalizeWords(subject)
    );

  const evidenceEmails =
    new Set(
      allEvidenceAddresses(evidence)
        .filter(
          email =>
            !isInternalWalltechAddress(email)
        )
    );

  /*
   * Measure how distinctive external contact addresses are.
   *
   * CONTACT_MATCH is allowed only when the address:
   * - is external to Walltech;
   * - appears in the evidence;
   * - belongs to one Deal only.
   *
   * Shared/internal addresses must never create Deal affinity.
   */
  const emailFrequency =
    new Map();

  for (const cycle of cycles) {
    const uniqueEmails =
      new Set(
        cycleEmails(cycle)
          .filter(
            email =>
              !isInternalWalltechAddress(email)
          )
      );

    for (const email of uniqueEmails) {
      emailFrequency.set(
        email,
        (emailFrequency.get(email) || 0) + 1
      );
    }
  }

  /*
   * Measure how distinctive each Deal-name token is.
   *
   * A token appearing in multiple Deal names is not sufficient,
   * by itself, to create a POSSIBLE_MATCH.
   *
   * Example:
   *   "sale" appears in multiple "Asset Sale" Deal names.
   *   A generic commercial email containing only "sale"
   *   must therefore NOT be associated with those Deals.
   */
  const tokenFrequency =
    new Map();

  for (const cycle of cycles) {
    const uniqueTokens =
      new Set(
        significantDealTokens(cycle)
      );

    for (const token of uniqueTokens) {
      tokenFrequency.set(
        token,
        (tokenFrequency.get(token) || 0) + 1
      );
    }
  }

  const candidates = [];

  for (const cycle of cycles) {
    if (
      !cycle.dealId ||
      !cycle.dealName
    ) {
      continue;
    }

    const tokens =
      significantDealTokens(cycle);

    const emailMatches =
      cycleEmails(cycle)
        .filter(
          email =>
            !isInternalWalltechAddress(email)
        )
        .filter(
          email =>
            evidenceEmails.has(email)
        )
        .filter(
          email =>
            emailFrequency.get(email) === 1
        );

    const tokenMatches =
      tokens.filter(token =>
        subjectWords.has(token)
      );

    const distinctiveTokenMatches =
      tokenMatches.filter(
        token =>
          tokenFrequency.get(token) === 1
      );

    let matchBasis = null;

    if (emailMatches.length > 0) {
      matchBasis =
        "CONTACT_MATCH";
    } else if (
      distinctiveTokenMatches.length >= 1 ||
      tokenMatches.length >= 2
    ) {
      matchBasis =
        "MAILBOX_SUBJECT_RELATIONSHIP";
    }

    if (matchBasis) {
      candidates.push({
        opportunityId:
          cycle.dealId,

        matchBasis,

        evidence: {
          emailMatches,
          tokenMatches,
          distinctiveTokenMatches,
        },
      });
    }
  }

  return candidates;
}

function main() {
  fs.mkdirSync(
    OUTPUT_DIR,
    { recursive: true }
  );

  const cycles =
    listJson(CYCLE_DIR)
      .map(readJson)
      .filter(cycle =>
        cycle.dealId &&
        cycle.dealName
      )
      .filter(
        isDealPipelineEligible
      );

  const evidence =
    listJson(EVIDENCE_DIR)
      .map(file => {
        try {
          return readJson(file);
        } catch {
          return null;
        }
      })
      .filter(item =>
        item &&
        item.evidenceType ===
          "MAIL_EVIDENCE" &&
        item.evidenceId
      );

  if (evidence.length === 0) {
    throw new Error(
      "NO CANONICAL MAIL EVIDENCE AVAILABLE"
    );
  }

  if (cycles.length === 0) {
    throw new Error(
      "NO COMMUNICATION CYCLES AVAILABLE"
    );
  }

  const events = [];

  /*
   * knownEvidence means evidence that existed BEFORE this
   * reconciliation run.
   *
   * Therefore it must come only from authoritative
   * CommunicationCycle state — never from the new mail snapshot.
   */
  const knownEvidenceByRef = new Map();

  for (const cycle of cycles) {
    const items =
      Array.isArray(cycle.evidence)
        ? cycle.evidence
        : [];

    for (const item of items) {
      const evidenceRef =
        item?.evidenceRef ||
        item?.mailEvidenceId ||
        (
          typeof item?.evidenceId === "string" &&
          item.evidenceId.startsWith("ME-")
            ? item.evidenceId
            : null
        );

      if (!evidenceRef) {
        continue;
      }

      if (!knownEvidenceByRef.has(evidenceRef)) {
        knownEvidenceByRef.set(
          evidenceRef,
          {
            evidenceRef,
            sourceSha256:
              item?.sourceSha256 ||
              item?.rawEvidence?.sourceSha256 ||
              null,
          }
        );
      }
    }
  }

  const knownEvidence =
    [...knownEvidenceByRef.values()]
      .sort(
        (a, b) =>
          a.evidenceRef.localeCompare(
            b.evidenceRef
          )
      );

  const authoritativeBindings = [];
  const candidateMatches = [];

  const audit = [];

  for (const item of evidence) {
    const collab =
      collaborator(item);

    const eventId =
      `EV-${sha(
        `${item.evidenceId}\n${collab.collaboratorId}`
      )}`;

    const occurredAt =
      item.identity?.date ||
      item.identity?.internalDate;

    if (!occurredAt) {
      continue;
    }

    events.push({
      eventId,

      collaboratorId:
        collab.collaboratorId,

      collaboratorName:
        collab.collaboratorName,

      occurredAt,

      channel:
        "EMAIL",

      eventType:
        "COMMUNICATION",

      direction:
        eventDirection(item),

      sourceProvenance:
        "DIRECT",

      evidenceRef:
        item.evidenceId,

      sourceSha256:
        item.rawEvidence?.sourceSha256 ||
        null,

      transportEvidenceRef:
        null,

      mailEvidenceId:
        item.evidenceId,

      candidateRelationshipId:
        null,

      messageId:
        item.identity?.messageId ||
        null,

      operationalEligibility:
        "OPERATIONAL",
    });

    const authoritativeDeal =
      existingBindingForEvidence(
        item,
        cycles
      );

    if (authoritativeDeal) {
      authoritativeBindings.push({
        evidenceRef:
          item.evidenceId,

        opportunityId:
          authoritativeDeal,

        bindingSource:
          "EXPLICIT_EXISTING_BINDING",
      });
    }

    const candidates =
      candidateDeals(
        item,
        cycles
      );

    for (const candidate of candidates) {
      candidateMatches.push({
        eventId,

        opportunityId:
          candidate.opportunityId,

        matchBasis:
          candidate.matchBasis,
      });
    }

    audit.push({
      evidenceId:
        item.evidenceId,

      subject:
        item.identity?.subject ||
        null,

      authoritativeDeal,

      candidates,
    });
  }

  const input = {
    reconciliationVersion:
      "1.0",

    reconciliationType:
      "COLLABORATOR_EVENT_RECONCILIATION_INPUT",

    reportId:
      `GENERIC-MAIL-2026-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}`,

    events,

    knownEvidence,

    authoritativeBindings,

    candidateMatches,
  };

  const inputPath =
    path.join(
      OUTPUT_DIR,
      "input.json"
    );

  const auditPath =
    path.join(
      OUTPUT_DIR,
      "candidate-audit.json"
    );

  writeJson(
    inputPath,
    input
  );

  writeJson(
    auditPath,
    audit
  );

  console.log(
    "GENERIC MAIL RECONCILIATION INPUT: PASS"
  );

  console.log(
    `MAIL EVIDENCE SNAPSHOT: ${evidence.length}`
  );

  console.log(
    `DEALS AVAILABLE: ${cycles.length}`
  );

  console.log(
    `EVENTS: ${events.length}`
  );

  console.log(
    `AUTHORITATIVE BINDINGS: ${authoritativeBindings.length}`
  );

  console.log(
    `CANDIDATE MATCHES: ${candidateMatches.length}`
  );

  console.log(
    `INPUT: ${path.relative(ROOT, inputPath)}`
  );

  console.log(
    `AUDIT: ${path.relative(ROOT, auditPath)}`
  );
}

main();
