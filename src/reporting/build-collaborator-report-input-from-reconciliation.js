const {
  validateReconciliationInput,
} = require(
  "./validate-collaborator-reconciliation-input.js"
);

const {
  buildReconciliation,
} = require(
  "./build-collaborator-reconciliation.js"
);

function fail(message) {
  throw new Error(
    `RECONCILIATION REPORT BRIDGE ERROR: ${message}`,
  );
}

function buildReportInputFromReconciliation(
  reconciliationInput,
  reconciliationResult,
) {
  /*
   * Revalidate the source operational batch.
   */
  validateReconciliationInput(
    reconciliationInput,
  );

  if (
    !reconciliationResult ||
    reconciliationResult.reconciliationType !==
      "COLLABORATOR_EVENT_RECONCILIATION_RESULT"
  ) {
    fail(
      "invalid reconciliation result type",
    );
  }

  if (
    reconciliationResult.reportId !==
    reconciliationInput.reportId
  ) {
    fail(
      "reportId mismatch",
    );
  }

  if (
    !Array.isArray(
      reconciliationResult.decisions,
    )
  ) {
    fail(
      "reconciliation decisions missing",
    );
  }

  if (
    reconciliationResult.decisions.length !==
    reconciliationInput.events.length
  ) {
    fail(
      "event/decision count mismatch",
    );
  }

  /*
   * Trust boundary:
   *
   * Never accept a supplied reconciliation result merely because
   * it has the correct shape, reportId or evidence references.
   *
   * Rebuild the canonical deterministic reconciliation from the
   * source batch and compare every decision-bearing field.
   *
   * generatedAt is deliberately excluded because it is
   * observational metadata, not decision semantics.
   */
  const canonicalResult =
    buildReconciliation(
      reconciliationInput,
    );

  function deterministicSnapshot(
    result,
  ) {
    return {
      reconciliationVersion:
        result.reconciliationVersion,

      reconciliationType:
        result.reconciliationType,

      reconciliationId:
        result.reconciliationId,

      reportId:
        result.reportId,

      decisionPolicy:
        result.decisionPolicy,

      decisions:
        result.decisions,

      counts:
        result.counts,

      mutationPolicy:
        result.mutationPolicy,
    };
  }

  const suppliedSnapshot =
    deterministicSnapshot(
      reconciliationResult,
    );

  const canonicalSnapshot =
    deterministicSnapshot(
      canonicalResult,
    );

  if (
    JSON.stringify(
      suppliedSnapshot,
    ) !==
    JSON.stringify(
      canonicalSnapshot,
    )
  ) {
    fail(
      "reconciliation result does not match canonical engine output",
    );
  }

  const decisionByEventId =
    new Map();

  for (
    const decision
    of reconciliationResult.decisions
  ) {
    if (
      decisionByEventId.has(
        decision.eventId,
      )
    ) {
      fail(
        `duplicate decision for event ${decision.eventId}`,
      );
    }

    decisionByEventId.set(
      decision.eventId,
      decision,
    );
  }

  const events =
    [...reconciliationInput.events]
      .sort(
        (a, b) => {
          const timeDifference =
            new Date(
              a.occurredAt,
            ).getTime() -
            new Date(
              b.occurredAt,
            ).getTime();

          if (
            timeDifference !== 0
          ) {
            return timeDifference;
          }

          return a.eventId.localeCompare(
            b.eventId,
          );
        },
      )
      .map(
        (event) => {
          const decision =
            decisionByEventId.get(
              event.eventId,
            );

          if (!decision) {
            fail(
              `missing decision for event ${event.eventId}`,
            );
          }

          if (
            decision.evidenceRef !==
            event.evidenceRef
          ) {
            fail(
              `evidenceRef mismatch for event ${event.eventId}`,
            );
          }

          const candidateOpportunityIds =
            [
              ...new Set(
                decision
                  .candidateOpportunityIds ||
                [],
              ),
            ].sort();

          let candidateOpportunityId =
            null;

          if (
            candidateOpportunityIds.length ===
            1
          ) {
            candidateOpportunityId =
              candidateOpportunityIds[0];
          }

          switch (
            decision.reconciliationOutcome
          ) {
            case "LINK_EXISTING":
              if (
                !decision.opportunityId
              ) {
                fail(
                  `LINK_EXISTING missing opportunityId for ${event.eventId}`,
                );
              }

              break;

            case "POSSIBLE_MATCH":
              if (
                decision.opportunityId !==
                null
              ) {
                fail(
                  `POSSIBLE_MATCH cannot contain confirmed opportunityId for ${event.eventId}`,
                );
              }

              if (
                candidateOpportunityIds.length <
                1
              ) {
                fail(
                  `POSSIBLE_MATCH requires candidate opportunity for ${event.eventId}`,
                );
              }

              break;

            case "NEW_CANDIDATE":
              if (
                decision.opportunityId !==
                null ||
                candidateOpportunityIds.length >
                  0
              ) {
                fail(
                  `NEW_CANDIDATE cannot contain existing opportunity references for ${event.eventId}`,
                );
              }

              break;

            case "EXACT_DUPLICATE":
            case "DISCARD":
              /*
               * Audit/excluded outcomes are still transported to
               * AZIONE 13 so the report generator performs the
               * deterministic INCLUDE/EXCLUDE decision itself.
               */
              break;

            default:
              fail(
                `unsupported reconciliation outcome ${decision.reconciliationOutcome}`,
              );
          }

          return {
            eventId:
              event.eventId,

            collaboratorId:
              event.collaboratorId,

            collaboratorName:
              event.collaboratorName,

            occurredAt:
              event.occurredAt,

            channel:
              event.channel,

            eventType:
              event.eventType,

            direction:
              event.direction,

            sourceProvenance:
              event.sourceProvenance,

            evidenceRef:
              event.evidenceRef,

            reconciliationOutcome:
              decision.reconciliationOutcome,

            opportunityId:
              decision.opportunityId ||
              null,

            candidateOpportunityId,

            candidateOpportunityIds,
          };
        },
      );

  /*
   * Every reconciliation decision must correspond to one
   * source event. No orphan decisions are allowed.
   */
  for (
    const decision
    of reconciliationResult.decisions
  ) {
    if (
      !reconciliationInput.events.some(
        (event) =>
          event.eventId ===
          decision.eventId,
      )
    ) {
      fail(
        `orphan reconciliation decision ${decision.eventId}`,
      );
    }
  }

  return {
    inputVersion: "1.0",
    reportId:
      reconciliationInput.reportId,
    events,
  };
}

module.exports = {
  buildReportInputFromReconciliation,
};
