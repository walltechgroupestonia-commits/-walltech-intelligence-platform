const {
  fetchMessageByUid,
} = require(
  "./read-imap-message-core.js"
);

function positiveUid(value) {
  const uid =
    Number(value);

  if (
    !Number.isInteger(uid) ||
    uid <= 0
  ) {
    throw new Error(
      `INVALID UID: ${value}`
    );
  }

  return uid;
}

async function main() {
  const accountKey =
    process.argv[2] ||
    "GMAIL_ESTONIA";

  const mailboxPath =
    process.argv[3] ||
    "INBOX";

  const uid =
    positiveUid(
      process.argv[4]
    );

  const outputPath =
    process.argv[5] ||
    null;

  const result =
    await fetchMessageByUid({
      accountKey,
      mailboxPath,
      uid,
      outputPath,
      provider:
        "GMAIL",
      envPrefix:
        accountKey,
    });

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  console.error("");
  console.error(
    "GMAIL MESSAGE CONTENT ACQUISITION: PASS"
  );

  console.error(
    `ACCOUNT: ${result.mailboxUser}`
  );

  console.error(
    `MAILBOX: ${result.mailboxPath}`
  );

  console.error(
    `UIDVALIDITY: ${result.uidValidity}`
  );

  console.error(
    `UID: ${result.uid}`
  );

  console.error(
    `MODE: ${result.accessMode}`
  );

  console.error(
    `SOURCE BYTES: ${result.sourceBytes}`
  );

  console.error(
    `SOURCE SHA256: ${result.sourceSha256}`
  );

  console.error(
    `FLAGS UNCHANGED: ${result.flagsUnchanged}`
  );
}

main().catch(
  error => {
    console.error("");
    console.error(
      "GMAIL MESSAGE CONTENT ACQUISITION: FAILED"
    );

    console.error(
      error?.message ||
      error
    );

    process.exit(1);
  }
);
