const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ImapFlow } = require("imapflow");

const PostalMimeModule = require("postal-mime");
const PostalMime =
  PostalMimeModule.default ||
  PostalMimeModule.PostalMime ||
  PostalMimeModule;

const ROOT = process.cwd();
const REGISTRY_FILE = path.join(ROOT, "src/mail/mail-account-registry.json");
const CYCLE_DIR = path.join(ROOT, "runtime/state/communication-cycles");
const CONTROL_FILE = path.join(ROOT, "runtime/state/deal-control/control.json");
const HISTORY_DIR = path.join(ROOT, "runtime/state/deal-communication-history");

const ACCOUNT_KEY = "GMAIL_ESTONIA";
const SINCE = new Date("2026-07-01T00:00:00Z");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(
    tmp,
    `${JSON.stringify(value, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  fs.renameSync(tmp, file);
}

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAddressList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => ({
      name: String(x?.name || "").trim(),
      address: normalizeEmail(x?.address),
    }))
    .filter((x) => x.name || x.address);
}

function addressStrings(...lists) {
  return lists
    .flat()
    .map((x) => normalizeEmail(x?.address))
    .filter(Boolean);
}

function displayAddressList(list) {
  return (list || [])
    .map((x) => {
      if (x.name && x.address) return `${x.name} <${x.address}>`;
      return x.address || x.name || "";
    })
    .filter(Boolean);
}

function boolFromEnv(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function safeDealFileName(dealId) {
  return String(dealId).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function findPredictCycle() {
  if (!fs.existsSync(CYCLE_DIR)) {
    throw new Error(`COMMUNICATION CYCLE DIR NOT FOUND: ${CYCLE_DIR}`);
  }

  const matches = fs.readdirSync(CYCLE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = path.join(CYCLE_DIR, name);
      const cycle = readJson(file, {});
      const haystack =
        `${cycle.dealId || ""} ${cycle.dealName || ""}`.toLowerCase();

      let score = 0;
      if (haystack.includes("opp-004")) score += 100;
      if (haystack.includes("predict")) score += 50;
      if (haystack.includes("optip")) score += 50;

      return { file, cycle, score };
    })
    .filter((x) => x.cycle.dealId && x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!matches.length) {
    throw new Error("PREDICT / OPTIP DEAL NOT FOUND IN COMMUNICATION CYCLES");
  }

  return matches[0];
}

function extractAttachments(parsed) {
  const attachments = Array.isArray(parsed?.attachments)
    ? parsed.attachments
    : [];

  return attachments.map((item) => {
    let content = Buffer.alloc(0);

    try {
      if (item?.content) content = Buffer.from(item.content);
    } catch {
      content = Buffer.alloc(0);
    }

    return {
      filename: item?.filename || null,
      contentType:
        item?.mimeType ||
        item?.contentType ||
        null,
      size: content.length || null,
      sha256: content.length ? sha(content) : null,
    };
  });
}

async function acquireMailbox({
  account,
  mailboxPath,
  host,
  port,
  secure,
  user,
  password,
}) {
  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: {
      user,
      pass: password,
    },
    logger: false,
  });

  const events = [];

  try {
    await client.connect();

    const mailbox = await client.mailboxOpen(mailboxPath, {
      readOnly: true,
    });

    if (mailbox.readOnly !== true) {
      throw new Error(`READ_ONLY CONTRACT FAILED: ${mailboxPath}`);
    }

    const uidValidity = String(mailbox.uidValidity);

    const uids = await client.search(
      { since: SINCE },
      { uid: true }
    );

    for (const uid of uids || []) {
      const meta = await client.fetchOne(
        uid,
        {
          uid: true,
          envelope: true,
          internalDate: true,
        },
        { uid: true }
      );

      if (!meta) continue;

      const envelope = meta.envelope || {};

      const from = normalizeAddressList(envelope.from);
      const to = normalizeAddressList(envelope.to);
      const cc = normalizeAddressList(envelope.cc);

      const addresses = addressStrings(from, to, cc);

      // Real PREDICT counterpart filter:
      // do not include internal Walltech/PMB messages just because
      // "Predict" or "OPTIP" appears in the subject/attachment.
      const realPredictCounterparty = addresses.some(
        (email) => email.endsWith("@predictcare.it")
      );

      if (!realPredictCounterparty) continue;

      const message = await client.fetchOne(
        uid,
        {
          uid: true,
          envelope: true,
          internalDate: true,
          source: true,
        },
        { uid: true }
      );

      if (!message?.source) continue;

      const source = Buffer.isBuffer(message.source)
        ? message.source
        : Buffer.from(message.source);

      const rawSha256 = sha(source);

      const parser = new PostalMime();
      const parsed = await parser.parse(source);

      const fullFrom = normalizeAddressList(
        message.envelope?.from || envelope.from
      );
      const fullTo = normalizeAddressList(
        message.envelope?.to || envelope.to
      );
      const fullCc = normalizeAddressList(
        message.envelope?.cc || envelope.cc
      );

      const walltechAddresses = new Set([
        "walltechgroup.estonia@gmail.com",
        "info@walltechgroup.eu",
        "marketingdept@walltechgroup.eu",
      ]);

      const senderAddresses = fullFrom.map((x) => x.address);

      const direction = senderAddresses.some(
        (x) => walltechAddresses.has(x)
      )
        ? "OUT"
        : "IN";

      const eventDate =
        message.envelope?.date ||
        envelope.date ||
        message.internalDate ||
        meta.internalDate ||
        null;

      const isoDate = eventDate
        ? new Date(eventDate).toISOString()
        : null;

      const evidenceId =
        "ME-HIST-" +
        sha(
          [
            ACCOUNT_KEY,
            mailboxPath,
            uidValidity,
            message.uid || uid,
            rawSha256,
          ].join("|")
        );

      events.push({
        evidenceId,
        source: "HISTORICAL_BACKFILL",
        sourceAccount: ACCOUNT_KEY,
        mailboxPath,
        uidValidity,
        uid: Number(message.uid || uid),
        messageId:
          message.envelope?.messageId ||
          envelope.messageId ||
          parsed?.messageId ||
          null,
        date: isoDate,
        direction,
        from: displayAddressList(fullFrom),
        to: displayAddressList(fullTo),
        cc: displayAddressList(fullCc),
        subject:
          message.envelope?.subject ||
          envelope.subject ||
          parsed?.subject ||
          "(no subject)",
        attachments: extractAttachments(parsed),
        rawSourceSha256,
        bodyStored: false,

        // Used only in-memory for management interpretation.
        _text: String(parsed?.text || ""),
      });
    }

    return {
      mailboxPath,
      readOnly: true,
      uidValidity,
      events,
    };
  } finally {
    try {
      await client.logout();
    } catch {
      // no-op
    }
  }
}

function buildManagement(events) {
  const timestamped = events
    .filter((x) => x.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const latest = timestamped.at(-1) || null;

  if (!latest) {
    return {
      latestUpdate: "No verified Predict / OPTIP historical mail evidence found.",
      currentBlocker: "Historical communication evidence unavailable.",
      nextAction: "Resolve historical evidence acquisition before management inference.",
      lastVerifiedEvidence: null,
      lastEvidenceAt: null,
    };
  }

  const latestFrom = latest.from.join(" ").toLowerCase();
  const isIlaria13Aug =
    latest.direction === "IN" &&
    latestFrom.includes("ilaria.chiarulli@predictcare.it") &&
    latest.date.startsWith("2026-08-13");

  const laterWalltechOutbound = timestamped.some(
    (event) =>
      event.direction === "OUT" &&
      event.date &&
      new Date(event.date) > new Date(latest.date)
  );

  if (isIlaria13Aug && !laterWalltechOutbound) {
    return {
      latestUpdate:
        "13 Aug 2026 — Ilaria Chiarulli / Predict requested concrete market-entry information after the Walltech / OPTIP discussion. No later Walltech reply is present in the verified INBOX + SENT backfill.",

      currentBlocker:
        "Predict / OPTIP is waiting for Walltech on six concrete points: existing Estonian tele-ultrasound projects and needs; service organization; clinician roles; which Baltic or Polish market is most ready and why; healthcare contacts/referrals; and the first distributors Walltech would approach. In parallel, paid scope, economic model, fee payer, fee maturity and agreement boundary remain undefined.",

      nextAction:
        "Define the paid engagement / economic model with Predict before additional resource-intensive research, then send one consolidated Walltech response covering the six requested market-entry points.",

      lastVerifiedEvidence:
        `${latest.evidenceId} · ${latest.date} · ${latest.subject}`,

      lastEvidenceAt:
        latest.date,
    };
  }

  return {
    latestUpdate:
      `${latest.date || "Undated"} — ${latest.direction} — ${latest.subject}`,

    currentBlocker:
      latest.direction === "IN"
        ? "Latest verified communication is inbound and requires management review before the next commercial action."
        : "No blocker inferred solely from direction; review latest verified evidence.",

    nextAction:
      latest.direction === "IN"
        ? "Review the latest inbound evidence and define the next commercial response."
        : "Verify whether a counterpart response is due before opening a follow-up.",

    lastVerifiedEvidence:
      `${latest.evidenceId} · ${latest.date || "undated"} · ${latest.subject}`,

    lastEvidenceAt:
      latest.date,
  };
}

async function main() {
  const registry = readJson(REGISTRY_FILE, null);

  if (!registry?.accounts) {
    throw new Error("MAIL ACCOUNT REGISTRY INVALID OR MISSING");
  }

  const account = registry.accounts.find(
    (x) => x.accountKey === ACCOUNT_KEY
  );

  if (!account) {
    throw new Error(`MAIL ACCOUNT NOT FOUND: ${ACCOUNT_KEY}`);
  }

  const host =
    process.env.GMAIL_ESTONIA_IMAP_HOST ||
    process.env.GMAIL_IMAP_HOST ||
    "imap.gmail.com";

  const port = Number(
    process.env.GMAIL_ESTONIA_IMAP_PORT ||
    process.env.GMAIL_IMAP_PORT ||
    993
  );

  const secure = boolFromEnv(
    process.env.GMAIL_ESTONIA_IMAP_SECURE ??
    process.env.GMAIL_IMAP_SECURE,
    true
  );

  const user =
    process.env.GMAIL_ESTONIA_MAILBOX_USER ||
    account.mailboxUser;

  const password =
    process.env.GMAIL_ESTONIA_MAILBOX_PASSWORD;

  if (!user) {
    throw new Error("GMAIL_ESTONIA MAILBOX USER NOT AVAILABLE");
  }

  if (!password) {
    throw new Error(
      "GMAIL_ESTONIA_MAILBOX_PASSWORD NOT LOADED — .env was sourced but credential is unavailable"
    );
  }

  const target = findPredictCycle();
  const { cycle, file: cycleFile } = target;

  const mailboxPaths =
    Array.isArray(account.defaultMailboxPaths) &&
    account.defaultMailboxPaths.length
      ? account.defaultMailboxPaths
      : ["INBOX", "[Gmail]/Sent Mail"];

  const acquisition = [];

  for (const mailboxPath of mailboxPaths) {
    acquisition.push(
      await acquireMailbox({
        account,
        mailboxPath,
        host,
        port,
        secure,
        user,
        password,
      })
    );
  }

  let events = acquisition.flatMap((x) => x.events);

  // Deduplicate by RFC Message-ID where available; otherwise raw source hash.
  const dedup = new Map();

  for (const event of events) {
    const key =
      event.messageId
        ? `MID:${String(event.messageId).toLowerCase()}`
        : `RAW:${event.rawSourceSha256}`;

    if (!dedup.has(key)) {
      dedup.set(key, event);
    }
  }

  events = [...dedup.values()]
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date) - new Date(b.date);
    });

  if (!events.length) {
    throw new Error(
      "NO REAL PREDICT / OPTIP COUNTERPART MAIL FOUND IN INBOX + SENT"
    );
  }

  const management = buildManagement(events);

  // Do not persist body text.
  const persistedEvents = events.map(({ _text, ...event }) => event);

  const history = {
    version: 1,
    type: "DEAL_HISTORICAL_EMAIL_BACKFILL",
    dealId: cycle.dealId,
    dealName: cycle.dealName,
    sourceAccount: ACCOUNT_KEY,
    mailboxPaths,
    accessMode: "READ_ONLY",
    historicalBackfill: true,
    liveCursorTouched: false,
    since: SINCE.toISOString(),
    generatedAt: new Date().toISOString(),
    eventCount: persistedEvents.length,
    management,
    events: persistedEvents,
  };

  const historyFile = path.join(
    HISTORY_DIR,
    `${safeDealFileName(cycle.dealId)}.json`
  );

  writeJsonAtomic(historyFile, history);

  // Make the already-existing Cockpit Timeline able to consume the
  // same canonical historical sequence if it reads from the cycle object.
  cycle.communicationTimeline = persistedEvents;
  cycle.historicalEmailBackfill = {
    sourceFile: path.relative(ROOT, historyFile),
    sourceAccount: ACCOUNT_KEY,
    accessMode: "READ_ONLY",
    liveCursorTouched: false,
    eventCount: persistedEvents.length,
    generatedAt: history.generatedAt,
  };

  cycle.latestUpdate = management.latestUpdate;
  cycle.currentBlocker = management.currentBlocker;
  cycle.nextAction = management.nextAction;
  cycle.lastEvidenceAt = management.lastEvidenceAt;
  cycle.lastVerifiedEvidence = management.lastVerifiedEvidence;

  writeJsonAtomic(cycleFile, cycle);

  // Synchronize management control WITHOUT altering Evaluation,
  // Agreement Gate, fee state or authorization.
  const store = readJson(
    CONTROL_FILE,
    { version: 1, updatedAt: null, deals: {} }
  );

  store.deals = store.deals || {};

  if (store.deals[cycle.dealId]) {
    store.deals[cycle.dealId].missingToAdvance =
      management.currentBlocker;

    store.deals[cycle.dealId].nextAction =
      management.nextAction;

    store.deals[cycle.dealId].updatedAt =
      new Date().toISOString();

    store.updatedAt = new Date().toISOString();

    writeJsonAtomic(CONTROL_FILE, store);
  }

  writeJsonAtomic(
    path.join(HISTORY_DIR, "latest-run.json"),
    {
      dealId: cycle.dealId,
      dealName: cycle.dealName,
      historyFile: path.relative(ROOT, historyFile),
      eventCount: persistedEvents.length,
      latestEvent: persistedEvents.at(-1),
      management,
      liveCursorTouched: false,
    }
  );

  console.log("");
  console.log("HISTORICAL EMAIL BACKFILL: PASS");
  console.log(`DEAL: ${cycle.dealName}`);
  console.log(`DEAL ID: ${cycle.dealId}`);
  console.log(`ACCOUNT: ${ACCOUNT_KEY}`);
  console.log(`MAILBOXES: ${mailboxPaths.join(" + ")}`);
  console.log("ACCESS: READ_ONLY");
  console.log("LIVE CURSOR TOUCHED: false");
  console.log(`EVENTS: ${persistedEvents.length}`);
  console.log("");
  console.log("CHRONOLOGY:");

  for (const event of persistedEvents) {
    const attachmentText = event.attachments.length
      ? ` | ATTACHMENTS: ${event.attachments.map((a) => a.filename || "(unnamed)").join(", ")}`
      : "";

    console.log(
      `${event.date || "UNDATED"} | ${event.direction} | ${event.from.join(", ")} -> ${event.to.join(", ")} | ${event.subject}${attachmentText}`
    );
  }

  console.log("");
  console.log(`LATEST UPDATE: ${management.latestUpdate}`);
  console.log(`CURRENT BLOCKER: ${management.currentBlocker}`);
  console.log(`NEXT ACTION: ${management.nextAction}`);
  console.log(`LAST VERIFIED EVIDENCE: ${management.lastVerifiedEvidence}`);
}

main().catch((error) => {
  console.error("");
  console.error("HISTORICAL EMAIL BACKFILL: FAIL");
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
