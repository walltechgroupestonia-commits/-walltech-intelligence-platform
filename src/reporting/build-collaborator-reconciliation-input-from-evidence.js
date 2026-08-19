const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  validateCollaboratorEvidenceAdapterInput,
} = require(
  "./validate-collaborator-evidence-adapter-input.js"
);

const {
  validateReconciliationInput,
} = require(
  "./validate-collaborator-reconciliation-input.js"
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

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
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

function sha256Text(value) {
  return crypto
    .createHash("sha256")
    .update(
      String(value),
      "utf8",
    )
    .digest("hex");
}

function mapDirection(
  detectionDirection,
) {
  switch (
    detectionDirection
  ) {
    case "INBOUND":
      return "INBOUND";

    case "OUTBOUND":
      return "OUTBOUND";

    case "SELF":
      return "INTERNAL";

    case "AMBIGUOUS":
      return "UNKNOWN";

    default:
      throw new Error(
        `UNSUPPORTED DETECTION DIRECTION: ${detectionDirection}`,
      );
  }
}

function buildRelationshipIndexes(
  detection,
) {
  const relationshipById =
    new Map();

  const relationshipIdByEvidenceId =
    new Map();

  for (
    const relationship
    of detection.candidateRelationships
  ) {
    relationshipById.set(
      relationship.candidateRelationshipId,
      relationship,
    );

    for (
      const evidenceId
      of relationship.evidenceIds
    ) {
      if (
        relationshipIdByEvidenceId.has(
          evidenceId,
        )
      ) {
        throw new Error(
          `EVIDENCE HAS MULTIPLE RELATIONSHIPS: ${evidenceId}`,
        );
      }

      relationshipIdByEvidenceId.set(
        evidenceId,
        relationship.candidateRelationshipId,
      );
    }
  }

  return {
    relationshipById,
    relationshipIdByEvidenceId,
  };
}

function buildDetectionMessageIndex(
  detection,
) {
  return new Map(
    detection.messages.map(
      (message) => [
        message.evidenceId,
        message,
      ],
    ),
  );
}

function buildEventId(
  evidenceId,
  collaboratorId,
) {
  const fingerprint = [
    "WALLTECH_COLLABORATOR_EMAIL_EVENT_V1",
    evidenceId,
    collaboratorId,
    "EMAIL",
    "COMMUNICATION",
  ].join("\n");

  return `CEV-${sha256Text(
    fingerprint,
  )}`;
}

function sortKnownEvidence(
  records,
) {
  return records
    .map(
      (record) => ({
        evidenceRef:
          record.evidenceRef,

        sourceSha256:
          record.sourceSha256,
      }),
    )
    .sort(
      (a, b) =>
        a.evidenceRef.localeCompare(
          b.evidenceRef,
        ) ||
        String(
          a.sourceSha256 ?? "",
        ).localeCompare(
          String(
            b.sourceSha256 ?? "",
          ),
        ),
    );
}

function sortAuthoritativeBindings(
  bindings,
) {
  return bindings
    .map(
      (binding) => ({
        evidenceRef:
          binding.evidenceRef,

        opportunityId:
          binding.opportunityId,

        bindingSource:
          binding.bindingSource,
      }),
    )
    .sort(
      (a, b) =>
        a.evidenceRef.localeCompare(
          b.evidenceRef,
        ) ||
        a.opportunityId.localeCompare(
          b.opportunityId,
        ) ||
        a.bindingSource.localeCompare(
          b.bindingSource,
        ),
    );
}

function buildCandidateMatches({
  opportunityHints,
  relationshipById,
  eventIdByEvidenceId,
}) {
  const candidateByKey =
    new Map();

  function addCandidate(
    evidenceId,
    opportunityId,
    matchBasis,
  ) {
    const eventId =
      eventIdByEvidenceId.get(
        evidenceId,
      );

    if (!eventId) {
      throw new Error(
        `CANDIDATE HINT RESOLVED TO UNKNOWN EVIDENCE: ${evidenceId}`,
      );
    }

    const candidate = {
      eventId,
      opportunityId,
      matchBasis,
    };

    const key = [
      candidate.eventId,
      candidate.opportunityId,
      candidate.matchBasis,
    ].join("::");

    /*
     * Exact duplicate hints are normalized away here.
     * Different opportunity IDs or match bases remain visible.
     */
    candidateByKey.set(
      key,
      candidate,
    );
  }

  for (
    const hint
    of opportunityHints
  ) {
    if (
      hint.evidenceId
    ) {
      addCandidate(
        hint.evidenceId,
        hint.opportunityId,
        hint.matchBasis,
      );

      continue;
    }

    const relationship =
      relationshipById.get(
        hint.candidateRelationshipId,
      );

    if (!relationship) {
      throw new Error(
        `UNKNOWN HINT RELATIONSHIP: ${hint.candidateRelationshipId}`,
      );
    }

    /*
     * Relationship hints are threading evidence only.
     * Expansion creates candidateMatches for each evidence item.
     * It NEVER creates an authoritative binding.
     */
    for (
      const evidenceId
      of relationship.evidenceIds
    ) {
      addCandidate(
        evidenceId,
        hint.opportunityId,
        hint.matchBasis,
      );
    }
  }

  return [
    ...candidateByKey.values(),
  ].sort(
    (a, b) =>
      a.eventId.localeCompare(
        b.eventId,
      ) ||
      a.opportunityId.localeCompare(
        b.opportunityId,
      ) ||
      a.matchBasis.localeCompare(
        b.matchBasis,
      ),
  );
}

function buildReconciliationInputFromEvidence(
  adapterInput,
) {
  /*
   * Validate all upstream semantic invariants first.
   * This resolves collaborator identity only through the
   * USER_CONFIRMED_DIRECTORY and rejects ambiguity fail-closed.
   */
  const validation =
    validateCollaboratorEvidenceAdapterInput(
      adapterInput,
    );

  const collaboratorResolutionByEvidenceId =
    validation
      .collaboratorResolutionByEvidenceId;

  const detectionMessageByEvidenceId =
    buildDetectionMessageIndex(
      adapterInput.communicationDetection,
    );

  const {
    relationshipById,
    relationshipIdByEvidenceId,
  } =
    buildRelationshipIndexes(
      adapterInput.communicationDetection,
    );

  const eventIdByEvidenceId =
    new Map();

  const events =
    adapterInput.mailEvidence
      .map(
        (evidence) => {
          const collaborator =
            collaboratorResolutionByEvidenceId[
              evidence.evidenceId
            ];

          if (!collaborator) {
            throw new Error(
              `MISSING COLLABORATOR RESOLUTION: ${evidence.evidenceId}`,
            );
          }

          const message =
            detectionMessageByEvidenceId.get(
              evidence.evidenceId,
            );

          if (!message) {
            throw new Error(
              `MISSING DETECTION MESSAGE: ${evidence.evidenceId}`,
            );
          }

          const candidateRelationshipId =
            relationshipIdByEvidenceId.get(
              evidence.evidenceId,
            );

          if (!candidateRelationshipId) {
            throw new Error(
              `MISSING CANDIDATE RELATIONSHIP: ${evidence.evidenceId}`,
            );
          }

          const occurredAt =
            evidence.identity.date ??
            evidence.identity.internalDate ??
            null;

          if (
            typeof occurredAt !==
              "string" ||
            occurredAt.length === 0
          ) {
            throw new Error(
              `MAIL EVIDENCE HAS NO EVENT DATE: ${evidence.evidenceId}`,
            );
          }

          const eventId =
            buildEventId(
              evidence.evidenceId,
              collaborator.collaboratorId,
            );

          eventIdByEvidenceId.set(
            evidence.evidenceId,
            eventId,
          );

          return {
            eventId,

            collaboratorId:
              collaborator.collaboratorId,

            collaboratorName:
              collaborator.collaboratorName,

            occurredAt,

            /*
             * MailEvidence proves that communication occurred.
             * It does NOT, by itself, prove semantic response.
             */
            channel:
              "EMAIL",

            eventType:
              "COMMUNICATION",

            direction:
              mapDirection(
                message.direction,
              ),

            sourceProvenance:
              "DIRECT",

            /*
             * MailEvidence ID is the canonical evidence reference
             * at this boundary. sourceSha256 provides content-level
             * duplicate reconciliation across mailbox coordinates.
             */
            evidenceRef:
              evidence.evidenceId,

            sourceSha256:
              evidence.rawEvidence
                .sourceSha256,

            transportEvidenceRef:
              null,

            mailEvidenceId:
              evidence.evidenceId,

            candidateRelationshipId,

            messageId:
              evidence.identity.messageId ??
              null,

            operationalEligibility:
              "OPERATIONAL",
          };
        },
      )
      .sort(
        (a, b) =>
          a.eventId.localeCompare(
            b.eventId,
          ),
      );

  const candidateMatches =
    buildCandidateMatches({
      opportunityHints:
        adapterInput.opportunityHints,

      relationshipById,

      eventIdByEvidenceId,
    });

  const result = {
    reconciliationVersion:
      "1.0",

    reconciliationType:
      "COLLABORATOR_EVENT_RECONCILIATION_INPUT",

    reportId:
      adapterInput.reportId,

    events,

    knownEvidence:
      sortKnownEvidence(
        adapterInput.knownEvidence,
      ),

    /*
     * Pass-through only.
     * No hint, subject, collaborator or relationship can create one.
     */
    authoritativeBindings:
      sortAuthoritativeBindings(
        adapterInput.authoritativeBindings,
      ),

    candidateMatches,
  };

  /*
   * Final downstream gate from AZIONE 14.
   * The adapter is not allowed to emit an object that the
   * reconciliation engine itself would reject.
   */
  validateReconciliationInput(
    result,
  );

  return result;
}

function main() {
  const inputPath =
    process.argv[2];

  const outputPath =
    process.argv[3] ??
    null;

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/build-collaborator-reconciliation-input-from-evidence.js <adapter-input.json> [output.json]",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const adapterInput =
      loadJson(
        inputPath,
        "COLLABORATOR EVIDENCE ADAPTER INPUT",
      );

    const result =
      buildReconciliationInputFromEvidence(
        adapterInput,
      );

    const json =
      `${JSON.stringify(
        result,
        null,
        2,
      )}\n`;

    if (
      outputPath
    ) {
      const absoluteOutputPath =
        path.resolve(
          process.cwd(),
          outputPath,
        );

      fs.mkdirSync(
        path.dirname(
          absoluteOutputPath,
        ),
        {
          recursive: true,
        },
      );

      fs.writeFileSync(
        absoluteOutputPath,
        json,
      );

      console.log(
        "COLLABORATOR EVIDENCE ADAPTER: PASS",
      );

      console.log(
        `REPORT: ${result.reportId}`,
      );

      console.log(
        `EVENTS: ${result.events.length}`,
      );

      console.log(
        `AUTHORITATIVE BINDINGS: ${result.authoritativeBindings.length}`,
      );

      console.log(
        `CANDIDATE MATCHES: ${result.candidateMatches.length}`,
      );

      console.log(
        "BUSINESS INFERENCE: NONE",
      );

      return;
    }

    process.stdout.write(
      json,
    );
  } catch (error) {
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
  buildReconciliationInputFromEvidence,
  buildEventId,
  mapDirection,
  buildCandidateMatches,
};
