const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } =
  require("node:child_process");

const REGISTRY_PATH =
  "src/mail/mail-account-registry.json";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function loadRegistry() {
  const absolute =
    path.resolve(
      process.cwd(),
      REGISTRY_PATH
    );

  if (!fs.existsSync(absolute)) {
    fail(
      `MAIL ACCOUNT REGISTRY NOT FOUND: ${REGISTRY_PATH}`,
      2
    );
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        absolute,
        "utf8"
      )
    );
  } catch (error) {
    fail(
      `MAIL ACCOUNT REGISTRY INVALID JSON: ${error.message}`,
      2
    );
  }
}

function resolveAccount(
  registry,
  lookup
) {
  const normalized =
    String(lookup)
      .trim()
      .toLowerCase();

  return (
    registry.accounts.find(
      (item) =>
        item.accountKey
          .toLowerCase() ===
          normalized ||
        item.mailboxUser
          .toLowerCase() ===
          normalized ||
        item.routingAddresses.some(
          (address) =>
            address.toLowerCase() ===
            normalized
        )
    ) || null
  );
}

function runNode(
  args,
  options = {}
) {
  const result =
    spawnSync(
      process.execPath,
      args,
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        ...options,
      }
    );

  if (result.stderr) {
    process.stderr.write(
      result.stderr
    );
  }

  if (result.status !== 0) {
    if (result.stdout) {
      process.stderr.write(
        result.stdout
      );
    }

    fail(
      `CHILD PROCESS FAILED (${result.status}): node ${args.join(" ")}`,
      result.status || 5
    );
  }

  return result;
}

function safeRemove(
  target
) {
  try {
    fs.rmSync(
      target,
      {
        recursive: true,
        force: true,
      }
    );
  } catch {
    // Best-effort cleanup only.
  }
}

function main() {
  const accountLookup =
    process.argv[2];

  const mailboxPath =
    process.argv[3];

  const uid =
    process.argv[4];

  const outputPath =
    process.argv[5] || null;

  if (
    !accountLookup ||
    !mailboxPath ||
    !uid
  ) {
    console.error(
      "Usage: node src/mail/acquire-mail-evidence.js <ACCOUNT_KEY|EMAIL> <MAILBOX_PATH> <UID> [OUTPUT_EVIDENCE_JSON]"
    );

    process.exit(2);
  }

  if (!/^[1-9][0-9]*$/.test(uid)) {
    fail(
      `INVALID UID: ${uid}`,
      2
    );
  }

  const registry =
    loadRegistry();

  const account =
    resolveAccount(
      registry,
      accountLookup
    );

  if (!account) {
    fail(
      `MAIL ACCOUNT NOT FOUND: ${accountLookup}`,
      4
    );
  }

  if (
    account.activationStatus !==
    "ACTIVE"
  ) {
    fail(
      `MAIL ACCOUNT NOT ACTIVE: ${account.accountKey} | ${account.activationStatus}`,
      6
    );
  }

  const adapterScript =
    {
      ARUBA_EXISTING_V1:
        "src/mail/read-aruba-message.js",

      GMAIL_IMAP_V1:
        "src/mail/read-gmail-message.js",
    }[
      account.providerAdapter
    ];

  if (!adapterScript) {
    fail(
      `MAIL PROVIDER ADAPTER NOT ACTIVE: ${account.providerAdapter}`,
      6
    );
  }

  const tempRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "walltech-mail-evidence-"
      )
    );

  const token =
    crypto
      .randomBytes(8)
      .toString("hex");

  const rawPath =
    path.join(
      tempRoot,
      `${token}.eml`
    );

  const acquisitionPath =
    path.join(
      tempRoot,
      `${token}-acquisition.json`
    );

  const normalizedPath =
    path.join(
      tempRoot,
      `${token}-normalized.json`
    );

  const evidencePath =
    path.join(
      tempRoot,
      `${token}-evidence.json`
    );

  try {
    const acquisition =
      runNode([
        adapterScript,
        account.providerAccountKey,
        mailboxPath,
        uid,
        rawPath,
      ]);

    fs.writeFileSync(
      acquisitionPath,
      acquisition.stdout
    );

    runNode([
      "src/mail/normalize-rfc822-message.js",
      rawPath,
      normalizedPath,
    ]);

    runNode([
      "src/mail/build-mail-evidence.js",
      acquisitionPath,
      normalizedPath,
      evidencePath,
    ]);

    runNode([
      "src/mail/validate-mail-evidence.js",
      evidencePath,
    ]);

    const evidence =
      JSON.parse(
        fs.readFileSync(
          evidencePath,
          "utf8"
        )
      );

    if (
      String(
        evidence.source.accountKey
      ).toUpperCase() !==
      String(
        account.providerAccountKey
      ).toUpperCase()
    ) {
      fail(
        `ACCOUNT LINK ERROR: registry ${account.providerAccountKey} != evidence ${evidence.source.accountKey}`,
        7
      );
    }

    if (
      evidence.source.mailboxUser
        .toLowerCase() !==
      account.mailboxUser
        .toLowerCase()
    ) {
      fail(
        `MAILBOX USER LINK ERROR: registry ${account.mailboxUser} != evidence ${evidence.source.mailboxUser}`,
        7
      );
    }

    const json =
      JSON.stringify(
        evidence,
        null,
        2
      ) + "\n";

    if (outputPath) {
      const absoluteOutput =
        path.resolve(
          process.cwd(),
          outputPath
        );

      fs.mkdirSync(
        path.dirname(
          absoluteOutput
        ),
        {
          recursive: true,
        }
      );

      fs.writeFileSync(
        absoluteOutput,
        json
      );
    } else {
      process.stdout.write(json);
    }

    console.error("");
    console.error(
      "GENERIC MAIL EVIDENCE ACQUISITION: PASS"
    );

    console.error(
      `ACCOUNT KEY: ${account.accountKey}`
    );

    console.error(
      `MAILBOX USER: ${account.mailboxUser}`
    );

    console.error(
      `PROVIDER: ${account.provider}`
    );

    console.error(
      `PROVIDER ADAPTER: ${account.providerAdapter}`
    );

    console.error(
      `MAIL EVIDENCE: ${evidence.evidenceId}`
    );

    console.error(
      "UPSTREAM PIPELINE REUSED: YES"
    );
  } finally {
    safeRemove(tempRoot);
  }
}

main();
