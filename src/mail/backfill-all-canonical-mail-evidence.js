const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ImapFlow } = require("imapflow");

const ROOT = process.cwd();
const SINCE = new Date("2026-01-01T00:00:00Z");

const REGISTRY = path.join(ROOT, "src/mail/mail-account-registry.json");
const OUT = path.join(ROOT, "runtime/state/historical-mail-evidence-2026");
const EVIDENCE_DIR = path.join(OUT, "canonical");
const STATUS = path.join(OUT, "status.json");
const SUMMARY = path.join(OUT, "summary.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
}

function bool(value, fallback = true) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase()
  );
}

function safe(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function configFor(account) {
  const key = String(account.providerAccountKey || account.accountKey)
    .toUpperCase();

  const gmail = account.providerAdapter === "GMAIL_IMAP_V1";

  const hostVar = gmail ? `${key}_IMAP_HOST` : "IMAP_HOST";
  const portVar = gmail ? `${key}_IMAP_PORT` : "IMAP_PORT";
  const secureVar = gmail ? `${key}_IMAP_SECURE` : "IMAP_SECURE";

  const userVar = `${key}_MAILBOX_USER`;
  const passVar = `${key}_MAILBOX_PASSWORD`;

  const cfg = {
    host: process.env[hostVar],
    port: Number(process.env[portVar] || 993),
    secure: bool(process.env[secureVar], true),
    user: process.env[userVar],
    password: process.env[passVar],
  };

  const missing = [];

  if (!cfg.host) missing.push(hostVar);
  if (!cfg.user) missing.push(userVar);
  if (!cfg.password) missing.push(passVar);

  if (missing.length) {
    throw new Error(`MISSING ENV: ${missing.join(", ")}`);
  }

  return cfg;
}

async function discover(account, mailboxPath) {
  const cfg = configFor(account);

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.password,
    },
    logger: false,
  });

  try {
    await client.connect();

    const mailbox = await client.mailboxOpen(mailboxPath, {
      readOnly: true,
    });

    if (mailbox.readOnly !== true) {
      throw new Error("READ_ONLY CONTRACT FAILED");
    }

    const uids = await client.search(
      { since: SINCE },
      { uid: true }
    );

    return Array.isArray(uids)
      ? [...new Set(uids.map(Number))].sort((a, b) => a - b)
      : [];
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const registry = readJson(REGISTRY);

  const accounts = (registry.accounts || []).filter(
    a => a.activationStatus === "ACTIVE"
  );

  const run = {
    product: "WALLTECH_GLOBAL_CANONICAL_MAIL_BACKFILL_2026",
    since: SINCE.toISOString(),
    startedAt: new Date().toISOString(),

    accessMode: "READ_ONLY",
    liveCursorTouched: false,

    status: "RUNNING",

    totals: {
      accounts: accounts.length,
      mailboxes: 0,
      discovered: 0,
      acquired: 0,
      resumedExisting: 0,
      failed: 0,
    },

    accounts: [],
    errors: [],
  };

  writeJson(STATUS, run);

  for (const account of accounts) {
    const accountResult = {
      accountKey: account.accountKey,
      mailboxes: [],
    };

    const mailboxes =
      Array.isArray(account.defaultMailboxPaths)
        ? account.defaultMailboxPaths
        : ["INBOX"];

    for (const mailboxPath of mailboxes) {
      run.totals.mailboxes++;

      const boxResult = {
        mailboxPath,
        discovered: 0,
        acquired: 0,
        resumedExisting: 0,
        failed: 0,
      };

      accountResult.mailboxes.push(boxResult);

      try {
        console.log("");
        console.log(`DISCOVER ${account.accountKey} / ${mailboxPath}`);

        const uids = await discover(account, mailboxPath);

        boxResult.discovered = uids.length;
        run.totals.discovered += uids.length;

        console.log(`FOUND: ${uids.length}`);

        let n = 0;

        for (const uid of uids) {
          n++;

          const filename =
            `${safe(account.accountKey)}__${safe(mailboxPath)}__UID-${uid}.json`;

          const outputFile = path.join(EVIDENCE_DIR, filename);

          if (fs.existsSync(outputFile)) {
            try {
              const existing = readJson(outputFile);

              if (
                existing &&
                existing.evidenceType === "MAIL_EVIDENCE"
              ) {
                boxResult.resumedExisting++;
                run.totals.resumedExisting++;
                continue;
              }
            } catch {}
          }

          const result = spawnSync(
            process.execPath,
            [
              "src/mail/acquire-mail-evidence.js",
              account.accountKey,
              mailboxPath,
              String(uid),
              outputFile,
            ],
            {
              cwd: ROOT,
              env: process.env,
              encoding: "utf8",
              maxBuffer: 10 * 1024 * 1024,
            }
          );

          if (result.status === 0) {
            boxResult.acquired++;
            run.totals.acquired++;
          } else {
            boxResult.failed++;
            run.totals.failed++;

            run.errors.push({
              accountKey: account.accountKey,
              mailboxPath,
              uid,
              error:
                String(result.stderr || result.stdout || "UNKNOWN ERROR")
                  .trim()
                  .slice(-1500),
            });
          }

          if (n % 25 === 0 || n === uids.length) {
            console.log(
              `${account.accountKey} / ${mailboxPath}: ` +
              `${n}/${uids.length} | ` +
              `NEW ${boxResult.acquired} | ` +
              `RESUMED ${boxResult.resumedExisting} | ` +
              `FAIL ${boxResult.failed}`
            );

            writeJson(STATUS, run);
          }
        }
      } catch (error) {
        boxResult.failed++;

        run.totals.failed++;

        run.errors.push({
          accountKey: account.accountKey,
          mailboxPath,
          error: error.message || String(error),
        });

        console.log(
          `MAILBOX FAIL: ${account.accountKey} / ${mailboxPath} — ` +
          `${error.message || error}`
        );
      }

      writeJson(STATUS, run);
    }

    run.accounts.push(accountResult);
    writeJson(STATUS, run);
  }

  run.completedAt = new Date().toISOString();

  run.status =
    run.totals.failed === 0
      ? "PASS"
      : run.totals.acquired + run.totals.resumedExisting > 0
        ? "PARTIAL"
        : "FAIL";

  writeJson(STATUS, run);
  writeJson(SUMMARY, run);

  console.log("");
  console.log("=== GLOBAL BACKFILL RESULT ===");
  console.log(`STATUS: ${run.status}`);
  console.log(`DISCOVERED: ${run.totals.discovered}`);
  console.log(`ACQUIRED NEW: ${run.totals.acquired}`);
  console.log(`RESUMED EXISTING: ${run.totals.resumedExisting}`);
  console.log(`FAILED: ${run.totals.failed}`);
  console.log("ACCESS MODE: READ_ONLY");
  console.log("LIVE CURSOR TOUCHED: false");
  console.log(`SUMMARY: ${path.relative(ROOT, SUMMARY)}`);
}

main().catch(error => {
  console.error("GLOBAL BACKFILL: FATAL");
  console.error(error?.stack || error);
  process.exit(1);
});
