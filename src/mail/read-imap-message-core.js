const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ImapFlow } = require("imapflow");

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase()
  );
}

function normalizeAddressList(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list.map((entry) => ({
    name: entry?.name || null,
    address: entry?.address || null,
  }));
}

function normalizeFlags(flags) {
  if (!flags) {
    return [];
  }

  return Array.from(flags).sort();
}

function getConfig(
  accountKey,
  {
    envPrefix = null,
  } = {},
) {
  const upperKey = String(accountKey || "").trim().toUpperCase();

  if (!upperKey) {
    fail("ACCOUNT KEY REQUIRED", 2);
  }

  const normalizedPrefix =
    envPrefix
      ? String(envPrefix)
          .trim()
          .toUpperCase()
      : null;

  const hostVariable =
    normalizedPrefix
      ? `${normalizedPrefix}_IMAP_HOST`
      : "IMAP_HOST";

  const portVariable =
    normalizedPrefix
      ? `${normalizedPrefix}_IMAP_PORT`
      : "IMAP_PORT";

  const secureVariable =
    normalizedPrefix
      ? `${normalizedPrefix}_IMAP_SECURE`
      : "IMAP_SECURE";

  const credentialPrefix =
    normalizedPrefix ||
    upperKey;

  const userVariable =
    `${credentialPrefix}_MAILBOX_USER`;

  const passwordVariable =
    `${credentialPrefix}_MAILBOX_PASSWORD`;

  const config = {
    accountKey:
      upperKey,

    host:
      process.env[hostVariable],

    port:
      Number(
        process.env[portVariable] ||
        993
      ),

    secure:
      parseBoolean(
        process.env[secureVariable],
        true
      ),

    user:
      process.env[userVariable],

    password:
      process.env[passwordVariable],
  };

  const missing = [];

  if (!config.host) {
    missing.push(
      hostVariable
    );
  }

  if (!config.port) {
    missing.push(
      portVariable
    );
  }
  if (!config.user) missing.push(userVariable);
  if (!config.password) missing.push(passwordVariable);

  if (missing.length > 0) {
    fail(`MISSING ENVIRONMENT VARIABLES: ${missing.join(", ")}`, 2);
  }

  return config;
}

function requirePositiveUid(value) {
  const uid = Number(value);

  if (!Number.isInteger(uid) || uid <= 0) {
    fail(`INVALID UID: ${value}`, 2);
  }

  return uid;
}

async function fetchMessageByUid({
  accountKey,
  mailboxPath,
  uid,
  outputPath,
  provider = "ARUBA",
  envPrefix = null,
}) {
  const config =
    getConfig(
      accountKey,
      {
        envPrefix,
      }
    );

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false,
  });

  let connected = false;

  try {
    await client.connect();
    connected = true;

    const mailbox = await client.mailboxOpen(mailboxPath, {
      readOnly: true,
    });

    if (mailbox.readOnly !== true) {
      fail(
        `MAILBOX NOT OPENED READ-ONLY: ${mailboxPath}`,
        6
      );
    }

    if (mailbox.uidValidity === undefined ||
        mailbox.uidValidity === null) {
      fail(
        `UIDVALIDITY NOT AVAILABLE: ${mailboxPath}`,
        7
      );
    }

    const uidValidity = String(mailbox.uidValidity);

    if (!/^[0-9]+$/.test(uidValidity)) {
      fail(
        `INVALID UIDVALIDITY: ${uidValidity}`,
        7
      );
    }

    /*
     * First fetch:
     * capture flags before requesting full RFC822 source.
     */
    const before = await client.fetchOne(
      uid,
      {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        size: true,
      },
      {
        uid: true,
      }
    );

    if (!before) {
      fail(
        `MESSAGE NOT FOUND: mailbox=${mailboxPath} uid=${uid}`,
        3
      );
    }

    const flagsBefore = normalizeFlags(before.flags);

    /*
     * Full source acquisition.
     *
     * source:true returns the complete RFC822 message source.
     * UID mode ensures we address the stable IMAP UID rather than
     * a sequence number.
     */
    const message = await client.fetchOne(
      uid,
      {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        size: true,
        source: true,
      },
      {
        uid: true,
      }
    );

    if (!message || !message.source) {
      fail(
        `MESSAGE SOURCE NOT ACQUIRED: mailbox=${mailboxPath} uid=${uid}`,
        4
      );
    }

    const source = Buffer.isBuffer(message.source)
      ? message.source
      : Buffer.from(message.source);

    if (source.length === 0) {
      fail(
        `MESSAGE SOURCE EMPTY: mailbox=${mailboxPath} uid=${uid}`,
        4
      );
    }

    /*
     * Third fetch:
     * verify that read-only source acquisition did not mutate flags.
     */
    const after = await client.fetchOne(
      uid,
      {
        uid: true,
        flags: true,
      },
      {
        uid: true,
      }
    );

    if (!after) {
      fail(
        `POST-ACQUISITION MESSAGE CHECK FAILED: mailbox=${mailboxPath} uid=${uid}`,
        5
      );
    }

    const flagsAfter = normalizeFlags(after.flags);
    const flagsUnchanged =
      JSON.stringify(flagsBefore) === JSON.stringify(flagsAfter);

    if (!flagsUnchanged) {
      fail(
        `READ-ONLY VIOLATION: flags changed for mailbox=${mailboxPath} uid=${uid}`,
        6
      );
    }

    let savedPath = null;

    if (outputPath) {
      savedPath = path.resolve(process.cwd(), outputPath);

      fs.mkdirSync(path.dirname(savedPath), {
        recursive: true,
      });

      fs.writeFileSync(savedPath, source);
    }

    const envelope = message.envelope || {};

    return {
      acquisitionVersion: "1.0",
      acquisitionType: "MESSAGE_CONTENT_BY_UID",
      sourceType: "IMAP",
      provider,
      accountKey: config.accountKey,
      mailboxUser: config.user,
      mailboxPath,
      accessMode: "READ_ONLY",
      mailboxReadOnly: true,
      selectorType: "UID",
      uidValidity,
      uid: message.uid ?? uid,
      seq: message.seq ?? null,

      messageId: envelope.messageId || null,
      date: envelope.date
        ? new Date(envelope.date).toISOString()
        : null,
      internalDate: message.internalDate
        ? new Date(message.internalDate).toISOString()
        : null,

      subject: envelope.subject || null,
      from: normalizeAddressList(envelope.from),
      to: normalizeAddressList(envelope.to),
      cc: normalizeAddressList(envelope.cc),
      replyTo: normalizeAddressList(envelope.replyTo),

      reportedSize: message.size ?? null,

      sourceBytes: source.length,
      sourceSha256: crypto
        .createHash("sha256")
        .update(source)
        .digest("hex"),

      flagsBefore,
      flagsAfter,
      flagsUnchanged,

      rawSourceSaved: Boolean(savedPath),
      rawSourcePath: savedPath,

      acquiredAt: new Date().toISOString(),
    };
  } finally {
    if (connected) {
      try {
        await client.logout();
      } catch {
        // Server may already have closed the connection.
      }
    }
  }
}


module.exports = {
  fetchMessageByUid,
};
