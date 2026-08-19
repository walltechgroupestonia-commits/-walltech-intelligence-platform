const fs = require("node:fs");
const path = require("node:path");

const { ImapFlow } =
  require("imapflow");

const Ajv2020 =
  require("ajv/dist/2020").default;

const addFormats =
  require("ajv-formats");

const discoverySchema =
  require(
    "./mailbox-new-uid-discovery.schema.json"
  );

const {
  validateMailboxProcessingCursor,
} = require(
  "./validate-mailbox-processing-cursor.js"
);

function parseBoolean(
  value,
  fallback,
) {
  if (
    value === undefined
  ) {
    return fallback;
  }

  return [
    "1",
    "true",
    "yes",
    "on",
  ].includes(
    String(value)
      .trim()
      .toLowerCase(),
  );
}

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

function getMailboxConfig(
  accountLookup,
) {
  const accountKey =
    String(
      accountLookup ??
      "",
    )
      .trim()
      .toUpperCase();

  if (!accountKey) {
    throw new Error(
      "ACCOUNT LOOKUP REQUIRED",
    );
  }

  const userVariable =
    `${accountKey}_MAILBOX_USER`;

  const passwordVariable =
    `${accountKey}_MAILBOX_PASSWORD`;

  const config = {
    accountKey,

    host:
      process.env.IMAP_HOST,

    port:
      Number(
        process.env.IMAP_PORT ||
        993,
      ),

    secure:
      parseBoolean(
        process.env.IMAP_SECURE,
        true,
      ),

    user:
      process.env[
        userVariable
      ],

    password:
      process.env[
        passwordVariable
      ],
  };

  const missing = [];

  if (!config.host) {
    missing.push(
      "IMAP_HOST",
    );
  }

  if (!config.port) {
    missing.push(
      "IMAP_PORT",
    );
  }

  if (!config.user) {
    missing.push(
      userVariable,
    );
  }

  if (!config.password) {
    missing.push(
      passwordVariable,
    );
  }

  if (
    missing.length > 0
  ) {
    throw new Error(
      `MISSING ENVIRONMENT VARIABLES: ${missing.join(", ")}`,
    );
  }

  return config;
}

function normalizeUidList(
  rawUids,
) {
  if (
    rawUids === false ||
    rawUids === null ||
    rawUids === undefined
  ) {
    return [];
  }

  if (
    !Array.isArray(
      rawUids,
    )
  ) {
    throw new Error(
      "UID SEARCH RESULT MUST BE AN ARRAY OR FALSE",
    );
  }

  const normalized =
    rawUids.map(
      value =>
        Number(value),
    );

  for (
    const uid
    of normalized
  ) {
    if (
      !Number.isSafeInteger(
        uid,
      ) ||
      uid < 1
    ) {
      throw new Error(
        `INVALID DISCOVERED UID: ${uid}`,
      );
    }
  }

  return [
    ...new Set(
      normalized,
    ),
  ].sort(
    (a, b) =>
      a - b,
  );
}

function validateDiscoveryResult(
  result,
) {
  const ajv =
    new Ajv2020({
      allErrors: true,
      strict: true,
    });

  addFormats(ajv);

  const validate =
    ajv.compile(
      discoverySchema,
    );

  const valid =
    validate(
      result,
    );

  if (!valid) {
    const details =
      (validate.errors ?? [])
        .map(
          error =>
            `${error.instancePath || "/"} ${error.message}`,
        )
        .join("; ");

    throw new Error(
      `DISCOVERY RESULT INVALID: ${details}`,
    );
  }

  if (
    result.newUidCount !==
    result.newUids.length
  ) {
    throw new Error(
      "DISCOVERY COUNT MISMATCH",
    );
  }

  return true;
}

function buildDiscoveryResult(
  cursor,
  observation,
  discoveredAt =
    new Date().toISOString(),
) {
  const cursorValidation =
    validateMailboxProcessingCursor(
      cursor,
    );

  if (
    !cursorValidation.valid
  ) {
    throw new Error(
      "CURSOR INVALID BEFORE DISCOVERY",
    );
  }

  const observedUidValidity =
    String(
      observation.uidValidity,
    );

  if (
    observedUidValidity !==
    cursor.uidValidity
  ) {
    throw new Error(
      `UIDVALIDITY MISMATCH: cursor=${cursor.uidValidity} mailbox=${observedUidValidity}`,
    );
  }

  const observedUidNext =
    Number(
      observation.uidNext,
    );

  if (
    !Number.isSafeInteger(
      observedUidNext,
    ) ||
    observedUidNext < 1
  ) {
    throw new Error(
      `INVALID OBSERVED UIDNEXT: ${observation.uidNext}`,
    );
  }

  const observedExists =
    Number(
      observation.exists ??
      0,
    );

  if (
    !Number.isSafeInteger(
      observedExists,
    ) ||
    observedExists < 0
  ) {
    throw new Error(
      `INVALID OBSERVED EXISTS: ${observation.exists}`,
    );
  }

  const startUid =
    cursor.boundaryUid + 1;

  const snapshotUpperUid =
    observedUidNext - 1;

  const searchRange =
    startUid <=
    snapshotUpperUid
      ? `${startUid}:${snapshotUpperUid}`
      : null;

  const newUids =
    normalizeUidList(
      observation.matchedUids,
    );

  for (
    const uid
    of newUids
  ) {
    if (
      uid <=
      cursor.boundaryUid
    ) {
      throw new Error(
        `DISCOVERED UID NOT ABOVE CURSOR: ${uid}`,
      );
    }

    if (
      uid >
      snapshotUpperUid
    ) {
      throw new Error(
        `DISCOVERED UID OUTSIDE SNAPSHOT: ${uid} > ${snapshotUpperUid}`,
      );
    }
  }

  if (
    searchRange === null &&
    newUids.length > 0
  ) {
    throw new Error(
      "DISCOVERY RETURNED UIDS WHEN SNAPSHOT HAS NO NEW RANGE",
    );
  }

  const result = {
    discoveryVersion:
      "1.0",

    discoveryType:
      "MAILBOX_NEW_UID_DISCOVERY",

    discoveryPolicy:
      "READ_ONLY_UIDVALIDITY_GUARDED_NO_CURSOR_MUTATION_V1",

    accountLookup:
      cursor.accountLookup,

    mailboxPath:
      cursor.mailboxPath,

    cursorUidValidity:
      cursor.uidValidity,

    cursorBoundaryUid:
      cursor.boundaryUid,

    observedUidValidity,

    observedUidNext,

    observedHighestModseq:
      observation.highestModseq ===
      null ||
      observation.highestModseq ===
      undefined
        ? null
        : String(
            observation.highestModseq,
          ),

    observedExists,

    searchRange,

    newUids,

    newUidCount:
      newUids.length,

    status:
      newUids.length > 0
        ? "NEW_UIDS_AVAILABLE"
        : "NO_NEW_MESSAGES",

    cursorMutation:
      false,

    mailboxMutation:
      false,

    discoveredAt,
  };

  validateDiscoveryResult(
    result,
  );

  return result;
}

async function observeMailbox(
  cursor,
) {
  const config =
    getMailboxConfig(
      cursor.accountLookup,
    );

  const client =
    new ImapFlow({
      host:
        config.host,

      port:
        config.port,

      secure:
        config.secure,

      auth: {
        user:
          config.user,

        pass:
          config.password,
      },

      logger:
        false,
    });

  let connected =
    false;

  try {
    await client.connect();
    connected = true;

    const mailbox =
      await client.mailboxOpen(
        cursor.mailboxPath,
        {
          readOnly: true,
        },
      );

    const uidValidity =
      String(
        mailbox.uidValidity,
      );

    /*
     * Critical fail-closed gate.
     * Never search against a different UID epoch.
     */
    if (
      uidValidity !==
      cursor.uidValidity
    ) {
      throw new Error(
        `UIDVALIDITY MISMATCH: cursor=${cursor.uidValidity} mailbox=${uidValidity}`,
      );
    }

    const uidNext =
      Number(
        mailbox.uidNext,
      );

    if (
      !Number.isSafeInteger(
        uidNext,
      ) ||
      uidNext < 1
    ) {
      throw new Error(
        `INVALID MAILBOX UIDNEXT: ${mailbox.uidNext}`,
      );
    }

    const startUid =
      cursor.boundaryUid + 1;

    /*
     * Snapshot upper bound.
     *
     * We deliberately do not search "start:*".
     * UIDNEXT observed at mailbox-open defines the
     * upper edge of this discovery snapshot.
     *
     * Messages arriving after this point belong
     * to the next discovery run.
     */
    const snapshotUpperUid =
      uidNext - 1;

    let matchedUids = [];

    if (
      startUid <=
      snapshotUpperUid
    ) {
      const range =
        `${startUid}:${snapshotUpperUid}`;

      const searchResult =
        await client.search(
          {
            uid:
              range,
          },
          {
            uid:
              true,
          },
        );

      matchedUids =
        normalizeUidList(
          searchResult,
        );
    }

    return {
      uidValidity,

      uidNext,

      highestModseq:
        mailbox.highestModseq ===
        null ||
        mailbox.highestModseq ===
        undefined
          ? null
          : String(
              mailbox.highestModseq,
            ),

      exists:
        Number(
          mailbox.exists ||
          0,
        ),

      matchedUids,
    };
  } finally {
    if (connected) {
      try {
        await client.logout();
      } catch {
        // Connection may already be closed.
      }
    }
  }
}

async function discoverNewMailboxUids(
  cursor,
  dependencies = {},
) {
  const observeMailboxFn =
    dependencies.observeMailboxFn ??
    observeMailbox;

  const cursorValidation =
    validateMailboxProcessingCursor(
      cursor,
    );

  if (
    !cursorValidation.valid
  ) {
    throw new Error(
      "CURSOR INVALID BEFORE MAILBOX ACCESS",
    );
  }

  const observation =
    await observeMailboxFn(
      cursor,
    );

  return buildDiscoveryResult(
    cursor,
    observation,
  );
}

async function main() {
  const cursorPath =
    process.argv[2];

  const outputPath =
    process.argv[3] ??
    null;

  if (!cursorPath) {
    console.error(
      "Usage: node src/mail/discover-new-mailbox-uids.js <cursor.json> [output.json]",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const cursor =
      loadJson(
        cursorPath,
        "MAILBOX PROCESSING CURSOR",
      );

    const result =
      await discoverNewMailboxUids(
        cursor,
      );

    const json =
      `${JSON.stringify(
        result,
        null,
        2,
      )}\n`;

    if (outputPath) {
      const absoluteOutput =
        path.resolve(
          process.cwd(),
          outputPath,
        );

      fs.mkdirSync(
        path.dirname(
          absoluteOutput,
        ),
        {
          recursive: true,
        },
      );

      fs.writeFileSync(
        absoluteOutput,
        json,
        "utf8",
      );
    } else {
      process.stdout.write(
        json,
      );
    }

    console.error(
      "MAILBOX NEW UID DISCOVERY: PASS",
    );

    console.error(
      `ACCOUNT: ${result.accountLookup}`,
    );

    console.error(
      `MAILBOX: ${result.mailboxPath}`,
    );

    console.error(
      `UIDVALIDITY: ${result.observedUidValidity}`,
    );

    console.error(
      `CURSOR BOUNDARY: ${result.cursorBoundaryUid}`,
    );

    console.error(
      `OBSERVED UIDNEXT: ${result.observedUidNext}`,
    );

    console.error(
      `SEARCH RANGE: ${result.searchRange ?? "NONE"}`,
    );

    console.error(
      `NEW UID COUNT: ${result.newUidCount}`,
    );

    console.error(
      `NEW UIDS: ${
        result.newUids.length
          ? result.newUids.join(",")
          : "NONE"
      }`,
    );

    console.error(
      `STATUS: ${result.status}`,
    );

    console.error(
      "CURSOR MUTATION: NONE",
    );

    console.error(
      "MAILBOX MUTATION: NONE",
    );
  } catch (error) {
    console.error(
      "MAILBOX NEW UID DISCOVERY: FAIL",
    );

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
  parseBoolean,
  getMailboxConfig,
  normalizeUidList,
  validateDiscoveryResult,
  buildDiscoveryResult,
  observeMailbox,
  discoverNewMailboxUids,
};
