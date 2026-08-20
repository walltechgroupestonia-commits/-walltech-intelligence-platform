const crypto =
  require("node:crypto");

function normalizeEmail(
  value,
) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  return normalized || null;
}

function normalizeName(
  value,
) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const normalized =
    value.trim();

  return normalized || null;
}

function normalizeAddressList(
  value,
) {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return value
    .map(
      entry => ({
        name:
          normalizeName(
            entry?.name,
          ),

        address:
          normalizeEmail(
            entry?.address,
          ),
      }),
    )
    .filter(
      entry =>
        entry.address,
    );
}

function deterministicCandidateId(
  email,
) {
  const hash =
    crypto
      .createHash("sha256")
      .update(email)
      .digest("hex")
      .slice(0, 20)
      .toUpperCase();

  return `MAIL-${hash}`;
}

function buildCollaboratorRegistryCandidates({
  mailEvidence,
  ownAddresses,
}) {
  if (
    !Array.isArray(mailEvidence)
  ) {
    throw new Error(
      "MAIL EVIDENCE MUST BE AN ARRAY",
    );
  }

  if (
    !Array.isArray(ownAddresses) ||
    ownAddresses.length === 0
  ) {
    throw new Error(
      "OWN ADDRESSES MUST BE A NON-EMPTY ARRAY",
    );
  }

  const own =
    new Set(
      ownAddresses
        .map(
          normalizeEmail,
        )
        .filter(Boolean),
    );

  if (
    own.size === 0
  ) {
    throw new Error(
      "OWN ADDRESSES CONTAIN NO VALID VALUES",
    );
  }

  const candidates =
    new Map();

  function register(
    person,
    evidenceId,
  ) {
    if (
      !person.address ||
      own.has(
        person.address,
      )
    ) {
      return;
    }

    let record =
      candidates.get(
        person.address,
      );

    if (!record) {
      record = {
        email:
          person.address,

        names:
          new Set(),

        evidenceRefs:
          new Set(),
      };

      candidates.set(
        person.address,
        record,
      );
    }

    if (person.name) {
      record.names.add(
        person.name,
      );
    }

    record.evidenceRefs.add(
      evidenceId,
    );
  }

  for (
    const evidence
    of mailEvidence
  ) {
    if (
      !evidence ||
      typeof evidence !== "object" ||
      typeof evidence.evidenceId !== "string" ||
      !evidence.evidenceId.trim()
    ) {
      throw new Error(
        "MAIL EVIDENCE RECORD MISSING EVIDENCE ID",
      );
    }

    const participants =
      evidence.participants || {};

    const from =
      normalizeAddressList(
        participants.from,
      );

    const sender =
      normalizeAddressList(
        participants.sender,
      );

    const to =
      normalizeAddressList(
        participants.to,
      );

    const cc =
      normalizeAddressList(
        participants.cc,
      );

    const bcc =
      normalizeAddressList(
        participants.bcc,
      );

    const replyTo =
      normalizeAddressList(
        participants.replyTo,
      );

    const fromOwn =
      [...from, ...sender]
        .some(
          person =>
            own.has(
              person.address,
            ),
        );

    const recipientOwn =
      [...to, ...cc, ...bcc]
        .some(
          person =>
            own.has(
              person.address,
            ),
        );

    let externalParticipants;

    if (
      fromOwn
    ) {
      /*
       * OUTBOUND:
       * candidate terminals are external recipients.
       */
      externalParticipants = [
        ...to,
        ...cc,
        ...bcc,
      ];
    } else if (
      recipientOwn
    ) {
      /*
       * INBOUND:
       * candidate terminal is external sender /
       * reply-to identity.
       */
      externalParticipants = [
        ...from,
        ...sender,
        ...replyTo,
      ];
    } else {
      /*
       * Ambiguous direction.
       * Identity evidence may still be retained as
       * CANDIDATE, but no business meaning is inferred.
       */
      externalParticipants = [
        ...from,
        ...sender,
        ...to,
        ...cc,
        ...bcc,
        ...replyTo,
      ];
    }

    const seen =
      new Set();

    for (
      const person
      of externalParticipants
    ) {
      if (
        own.has(
          person.address,
        ) ||
        seen.has(
          person.address,
        )
      ) {
        continue;
      }

      seen.add(
        person.address,
      );

      register(
        person,
        evidence.evidenceId,
      );
    }
  }

  const collaborators =
    [...candidates.values()]
      .sort(
        (a, b) =>
          a.email.localeCompare(
            b.email,
          ),
      )
      .map(
        record => {
          const names =
            [...record.names]
              .sort();

          return {
            collaboratorId:
              deterministicCandidateId(
                record.email,
              ),

            displayName:
              names.length === 1
                ? names[0]
                : null,

            emailAddresses: [
              record.email,
            ],

            registryStatus:
              "CANDIDATE",

            identitySource:
              "MAIL_EVIDENCE",

            evidenceRefs:
              [...record.evidenceRefs]
                .sort(),
          };
        },
      );

  return {
    registryVersion:
      "1.0",

    registryType:
      "WALLTECH_COLLABORATOR_REGISTRY",

    collaborators,
  };
}

module.exports = {
  buildCollaboratorRegistryCandidates,
  deterministicCandidateId,
  normalizeAddressList,
};
