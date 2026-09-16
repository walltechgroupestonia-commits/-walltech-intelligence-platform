const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  verifyCalendlyWebhookSignature
} = require("./verify-calendly-webhook-signature");

const {
  extractUuid,
  adaptCalendlyRoutingSubmission
} = require("./adapt-calendly-routing-submission");

const EVENT_TYPE =
  "routing_form_submission.created";

function sha256(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function ensureDir(dir) {
  fs.mkdirSync(
    dir,
    {
      recursive: true,
      mode: 0o700
    }
  );
}

function writePrivate(file, data) {
  fs.writeFileSync(
    file,
    data,
    {
      mode: 0o600,
      flag: "wx"
    }
  );
}

function safeRemoveTree(dir) {
  try {
    fs.rmSync(
      dir,
      {
        recursive: true,
        force: true
      }
    );
  } catch {}
}

function ingestCalendlyWebhook({
  signatureHeader,
  signingKey,
  rawBody,
  rootDir =
    path.join(
      process.cwd(),
      "runtime/state/lead-evidence"
    ),
  allowedRoutingFormIds,
  nowMs = Date.now()
}) {
  if (!Buffer.isBuffer(rawBody)) {
    throw new Error(
      "CALENDLY WEBHOOK RAW BODY BUFFER REQUIRED"
    );
  }

  const verification =
    verifyCalendlyWebhookSignature({
      signatureHeader,
      signingKey,
      rawBody,
      nowMs
    });

  if (!verification.valid) {
    throw new Error(
      `CALENDLY WEBHOOK REJECTED: ${verification.reason}`
    );
  }

  let envelope;

  try {
    envelope =
      JSON.parse(
        rawBody.toString("utf8")
      );
  } catch {
    throw new Error(
      "CALENDLY WEBHOOK INVALID JSON"
    );
  }

  if (
    envelope.event !==
    EVENT_TYPE
  ) {
    throw new Error(
      "CALENDLY WEBHOOK EVENT NOT SUPPORTED"
    );
  }

  if (
    !envelope.payload ||
    typeof envelope.payload !== "object"
  ) {
    throw new Error(
      "CALENDLY WEBHOOK PAYLOAD MISSING"
    );
  }

  const routingFormId =
    extractUuid(
      envelope.payload.routing_form
    );

  if (!routingFormId) {
    throw new Error(
      "CALENDLY ROUTING FORM ID MISSING"
    );
  }

  if (
    !Array.isArray(
      allowedRoutingFormIds
    ) ||
    allowedRoutingFormIds.length === 0
  ) {
    throw new Error(
      "CALENDLY ALLOWED ROUTING FORMS REQUIRED"
    );
  }

  const allowed =
    new Set(
      allowedRoutingFormIds.map(
        value =>
          String(value)
            .trim()
            .toLowerCase()
      )
    );

  if (
    !allowed.has(
      routingFormId.toLowerCase()
    )
  ) {
    throw new Error(
      "CALENDLY ROUTING FORM NOT ALLOWED"
    );
  }

  const receivedAt =
    new Date(nowMs)
      .toISOString();

  const evidence =
    adaptCalendlyRoutingSubmission(
      envelope.payload,
      {
        capturedAt:
          receivedAt
      }
    );

  const eventsDir =
    path.join(
      rootDir,
      "events"
    );

  ensureDir(eventsDir);

  const finalDir =
    path.join(
      eventsDir,
      evidence.evidenceId
    );

  /*
   * The evidence ID derives from
   * submission ID + Calendly updated_at.
   * Same delivery/retry = same directory.
   */
  if (fs.existsSync(finalDir)) {
    return {
      status: "DUPLICATE",
      leadId:
        evidence.leadId,
      evidenceId:
        evidence.evidenceId,
      persisted: false
    };
  }

  const tmpDir =
    path.join(
      eventsDir,
      `.tmp-${evidence.evidenceId}-${process.pid}-${crypto.randomBytes(6).toString("hex")}`
    );

  ensureDir(tmpDir);

  try {
    const rawHash =
      sha256(rawBody);

    const receipt = {
      receiptVersion: "1.0",
      receiptType:
        "CALENDLY_WEBHOOK_RECEIPT",

      event:
        envelope.event,

      leadId:
        evidence.leadId,

      evidenceId:
        evidence.evidenceId,

      routingFormId,

      signatureVerified: true,

      signatureTimestamp:
        verification.timestamp,

      rawSha256:
        rawHash,

      rawBytes:
        rawBody.length,

      receivedAt
    };

    writePrivate(
      path.join(
        tmpDir,
        "webhook.raw.json"
      ),
      rawBody
    );

    writePrivate(
      path.join(
        tmpDir,
        "lead-evidence.json"
      ),
      Buffer.from(
        JSON.stringify(
          evidence,
          null,
          2
        ) + "\n",
        "utf8"
      )
    );

    writePrivate(
      path.join(
        tmpDir,
        "receipt.json"
      ),
      Buffer.from(
        JSON.stringify(
          receipt,
          null,
          2
        ) + "\n",
        "utf8"
      )
    );

    /*
     * Atomic publication of the complete
     * evidence bundle.
     */
    try {
      fs.renameSync(
        tmpDir,
        finalDir
      );
    } catch (error) {
      if (
        error.code === "EEXIST" ||
        error.code === "ENOTEMPTY"
      ) {
        safeRemoveTree(
          tmpDir
        );

        return {
          status: "DUPLICATE",
          leadId:
            evidence.leadId,
          evidenceId:
            evidence.evidenceId,
          persisted: false
        };
      }

      throw error;
    }

    return {
      status: "CREATED",
      leadId:
        evidence.leadId,
      evidenceId:
        evidence.evidenceId,
      persisted: true
    };
  } catch (error) {
    safeRemoveTree(
      tmpDir
    );

    throw error;
  }
}

module.exports = {
  EVENT_TYPE,
  ingestCalendlyWebhook
};
