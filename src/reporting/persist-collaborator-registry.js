const fs =
  require("node:fs");

const path =
  require("node:path");

function clone(
  value,
) {
  return structuredClone(
    value,
  );
}

function normalizedEmail(
  value,
) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const result =
    value
      .trim()
      .toLowerCase();

  return result || null;
}

function emailsOf(
  collaborator,
) {
  return Array.isArray(
    collaborator?.emailAddresses,
  )
    ? collaborator.emailAddresses
        .map(normalizedEmail)
        .filter(Boolean)
    : [];
}

function evidenceOf(
  collaborator,
) {
  return Array.isArray(
    collaborator?.evidenceRefs,
  )
    ? collaborator.evidenceRefs
        .filter(
          value =>
            typeof value === "string" &&
            value.trim(),
        )
    : [];
}

function buildEmailIndex(
  collaborators,
) {
  const index =
    new Map();

  for (
    let i = 0;
    i < collaborators.length;
    i += 1
  ) {
    for (
      const email
      of emailsOf(
        collaborators[i],
      )
    ) {
      if (
        index.has(email) &&
        index.get(email) !== i
      ) {
        throw new Error(
          `REGISTRY EMAIL COLLISION: ${email}`,
        );
      }

      index.set(
        email,
        i,
      );
    }
  }

  return index;
}

function mergeCollaboratorRegistry(
  existingRegistry,
  incomingRegistry,
) {
  if (
    incomingRegistry?.registryType !==
    "WALLTECH_COLLABORATOR_REGISTRY"
  ) {
    throw new Error(
      "INCOMING REGISTRY TYPE INVALID",
    );
  }

  const existing =
    existingRegistry
      ? clone(existingRegistry)
      : {
          registryVersion:
            "1.0",

          registryType:
            "WALLTECH_COLLABORATOR_REGISTRY",

          collaborators:
            [],
        };

  if (
    existing.registryType !==
    "WALLTECH_COLLABORATOR_REGISTRY" ||
    !Array.isArray(
      existing.collaborators,
    )
  ) {
    throw new Error(
      "EXISTING REGISTRY INVALID",
    );
  }

  const collaborators =
    clone(
      existing.collaborators,
    );

  let emailIndex =
    buildEmailIndex(
      collaborators,
    );

  for (
    const incoming
    of incomingRegistry.collaborators || []
  ) {
    const incomingEmails =
      emailsOf(incoming);

    if (
      incomingEmails.length === 0
    ) {
      throw new Error(
        `INCOMING COLLABORATOR WITHOUT EMAIL: ${incoming?.collaboratorId || "UNKNOWN"}`,
      );
    }

    const matchingIndexes =
      new Set(
        incomingEmails
          .map(
            email =>
              emailIndex.get(email),
          )
          .filter(
            value =>
              Number.isSafeInteger(
                value,
              ),
          ),
      );

    if (
      matchingIndexes.size > 1
    ) {
      throw new Error(
        `INCOMING IDENTITY MATCHES MULTIPLE REGISTRY RECORDS: ${incomingEmails.join(",")}`,
      );
    }

    if (
      matchingIndexes.size === 0
    ) {
      collaborators.push(
        clone(incoming),
      );

      emailIndex =
        buildEmailIndex(
          collaborators,
        );

      continue;
    }

    const index =
      [...matchingIndexes][0];

    const current =
      collaborators[index];

    /*
     * Existing human state wins over automatic discovery.
     * A new MAIL_EVIDENCE observation must never downgrade
     * CONFIRMED or REJECTED to CANDIDATE.
     */
    const preserveHumanState =
      current.registryStatus ===
        "CONFIRMED" ||
      current.registryStatus ===
        "REJECTED";

    const incomingHumanState =
      (
        incoming.registryStatus ===
          "CONFIRMED" ||
        incoming.registryStatus ===
          "REJECTED"
      ) &&
      incoming.identitySource ===
        "USER_CONFIRMED_DIRECTORY";

    const mergedEmails =
      [
        ...new Set([
          ...emailsOf(current),
          ...incomingEmails,
        ]),
      ].sort();

    const mergedEvidence =
      [
        ...new Set([
          ...evidenceOf(current),
          ...evidenceOf(incoming),
        ]),
      ].sort();

    collaborators[index] = {
      collaboratorId:
        preserveHumanState
          ? current.collaboratorId
          : incomingHumanState
            ? incoming.collaboratorId
            : current.collaboratorId ||
              incoming.collaboratorId,

      displayName:
        incomingHumanState
          ? incoming.displayName ||
            current.displayName ||
            null
          : current.displayName ||
            incoming.displayName ||
            null,

      emailAddresses:
        mergedEmails,

      registryStatus:
        preserveHumanState
          ? current.registryStatus
          : incomingHumanState
            ? incoming.registryStatus
            : "CANDIDATE",

      identitySource:
        preserveHumanState
          ? current.identitySource
          : incomingHumanState
            ? "USER_CONFIRMED_DIRECTORY"
            : "MAIL_EVIDENCE",

      evidenceRefs:
        mergedEvidence,
    };

    emailIndex =
      buildEmailIndex(
        collaborators,
      );
  }

  collaborators.sort(
    (a, b) =>
      emailsOf(a)[0]
        .localeCompare(
          emailsOf(b)[0],
        ),
  );

  return {
    registryVersion:
      "1.0",

    registryType:
      "WALLTECH_COLLABORATOR_REGISTRY",

    collaborators,
  };
}

function readRegistryIfExists(
  registryPath,
) {
  if (
    !fs.existsSync(
      registryPath,
    )
  ) {
    return null;
  }

  return JSON.parse(
    fs.readFileSync(
      registryPath,
      "utf8",
    ),
  );
}

function writeRegistryAtomically(
  registryPath,
  registry,
) {
  fs.mkdirSync(
    path.dirname(
      registryPath,
    ),
    {
      recursive: true,
    },
  );

  const tempPath =
    `${registryPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    fs.writeFileSync(
      tempPath,
      `${JSON.stringify(
        registry,
        null,
        2,
      )}\n`,
      {
        encoding:
          "utf8",

        mode:
          0o600,
      },
    );

    fs.renameSync(
      tempPath,
      registryPath,
    );
  } finally {
    if (
      fs.existsSync(
        tempPath,
      )
    ) {
      fs.rmSync(
        tempPath,
        {
          force: true,
        },
      );
    }
  }

  return registry;
}

function persistCollaboratorRegistry({
  registryPath,
  incomingRegistry,
}) {
  if (
    typeof registryPath !== "string" ||
    !registryPath.trim()
  ) {
    throw new Error(
      "REGISTRY PATH REQUIRED",
    );
  }

  const existingRegistry =
    readRegistryIfExists(
      registryPath,
    );

  const mergedRegistry =
    mergeCollaboratorRegistry(
      existingRegistry,
      incomingRegistry,
    );

  writeRegistryAtomically(
    registryPath,
    mergedRegistry,
  );

  return mergedRegistry;
}

module.exports = {
  mergeCollaboratorRegistry,
  persistCollaboratorRegistry,
  readRegistryIfExists,
  writeRegistryAtomically,
};
