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

  return Array.from(flags);
}

function normalizeMessage(message) {
  const envelope = message.envelope || {};

  return {
    seq: message.seq ?? null,
    uid: message.uid ?? null,
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
    flags: normalizeFlags(message.flags),
    size: message.size ?? null,
  };
}

function getConfig(accountKey) {
  const upperKey = String(accountKey || "").trim().toUpperCase();

  if (!upperKey) {
    fail("ACCOUNT KEY REQUIRED", 2);
  }

  const userVariable = `${upperKey}_MAILBOX_USER`;
  const passwordVariable = `${upperKey}_MAILBOX_PASSWORD`;

  const config = {
    accountKey: upperKey,
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: parseBoolean(process.env.IMAP_SECURE, true),
    user: process.env[userVariable],
    password: process.env[passwordVariable],
  };

  const missing = [];

  if (!config.host) missing.push("IMAP_HOST");
  if (!config.port) missing.push("IMAP_PORT");
  if (!config.user) missing.push(userVariable);
  if (!config.password) missing.push(passwordVariable);

  if (missing.length > 0) {
    fail(`MISSING ENVIRONMENT VARIABLES: ${missing.join(", ")}`, 2);
  }

  return config;
}

async function readMailbox({
  accountKey,
  mailboxPath,
  limit,
}) {
  const config = getConfig(accountKey);

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

    const mailbox = await client.mailboxOpen(
      mailboxPath,
      {
        readOnly: true,
      }
    );

    const totalMessages = mailbox.exists || 0;

    let messages = [];

    if (totalMessages > 0) {
      const requestedLimit = Math.max(
        1,
        Math.min(Number(limit) || 10, 100)
      );

      const startSequence = Math.max(
        1,
        totalMessages - requestedLimit + 1
      );

      messages = await client.fetchAll(
        `${startSequence}:*`,
        {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          size: true,
        }
      );
    }

    return {
      acquisitionVersion: "1.0",
      sourceType: "IMAP",
      provider: "ARUBA",
      accountKey: config.accountKey,
      mailboxUser: config.user,
      mailboxPath,
      accessMode: "READ_ONLY",
      totalMessages,
      fetchedMessages: messages.length,
      acquiredAt: new Date().toISOString(),
      messages: messages.map(normalizeMessage),
    };
  } finally {
    if (connected) {
      try {
        await client.logout();
      } catch {
        // Connection may already have been closed by server.
      }
    }
  }
}

async function main() {
  const accountKey = process.argv[2] || "INFO";
  const mailboxPath = process.argv[3] || "INBOX";
  const limit = process.argv[4] || "10";

  const result = await readMailbox({
    accountKey,
    mailboxPath,
    limit,
  });

  console.log(JSON.stringify(result, null, 2));

  console.error("");
  console.error("ARUBA MAIL ACQUISITION: PASS");
  console.error(`ACCOUNT: ${result.mailboxUser}`);
  console.error(`MAILBOX: ${result.mailboxPath}`);
  console.error(`MODE: ${result.accessMode}`);
  console.error(`TOTAL MESSAGES: ${result.totalMessages}`);
  console.error(`FETCHED: ${result.fetchedMessages}`);
}

main().catch((error) => {
  console.error("");
  console.error("ARUBA MAIL ACQUISITION: FAILED");
  console.error(error?.message || error);
  process.exit(1);
});
