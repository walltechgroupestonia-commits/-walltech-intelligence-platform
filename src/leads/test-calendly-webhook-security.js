const assert =
  require("node:assert");

const {
  expectedSignature,
  verifyCalendlyWebhookSignature
} = require(
  "./verify-calendly-webhook-signature"
);

const signingKey =
  "walltech-calendly-test-signing-key";

const timestamp =
  1789563600;

const rawBody =
  Buffer.from(
    JSON.stringify({
      event:
        "routing_form_submission.created",
      payload: {
        uri:
          "https://api.calendly.com/routing_form_submissions/42a1bcc9-1809-48b6-87a4-62e6a0eae37b"
      }
    }),
    "utf8"
  );

const signature =
  expectedSignature({
    signingKey,
    timestamp,
    rawBody
  });

const header =
  `t=${timestamp},v1=${signature}`;

const valid =
  verifyCalendlyWebhookSignature({
    signatureHeader: header,
    signingKey,
    rawBody,
    nowMs:
      timestamp * 1000
  });

assert.strictEqual(
  valid.valid,
  true
);

assert.strictEqual(
  valid.reason,
  "PASS"
);

/*
 * Tampered payload MUST fail.
 */
const tampered =
  Buffer.from(
    rawBody
      .toString("utf8")
      .replace(
        "42a1bcc9",
        "52a1bcc9"
      ),
    "utf8"
  );

const tamperedResult =
  verifyCalendlyWebhookSignature({
    signatureHeader: header,
    signingKey,
    rawBody: tampered,
    nowMs:
      timestamp * 1000
  });

assert.strictEqual(
  tamperedResult.valid,
  false
);

assert.strictEqual(
  tamperedResult.reason,
  "SIGNATURE_MISMATCH"
);

/*
 * Old webhook MUST fail
 * to prevent replay attacks.
 */
const replay =
  verifyCalendlyWebhookSignature({
    signatureHeader: header,
    signingKey,
    rawBody,
    nowMs:
      (timestamp + 181) *
      1000
  });

assert.strictEqual(
  replay.valid,
  false
);

assert.strictEqual(
  replay.reason,
  "TIMESTAMP_OUTSIDE_TOLERANCE"
);

/*
 * Wrong signing key MUST fail.
 */
const wrongKey =
  verifyCalendlyWebhookSignature({
    signatureHeader: header,
    signingKey:
      "wrong-key",
    rawBody,
    nowMs:
      timestamp * 1000
  });

assert.strictEqual(
  wrongKey.valid,
  false
);

assert.strictEqual(
  wrongKey.reason,
  "SIGNATURE_MISMATCH"
);

/*
 * Missing header MUST fail closed.
 */
assert.throws(
  () =>
    verifyCalendlyWebhookSignature({
      signatureHeader: null,
      signingKey,
      rawBody,
      nowMs:
        timestamp * 1000
    }),
  /HEADER MISSING/
);

console.log(
  "CALENDLY WEBHOOK SECURITY V1: PASS"
);

console.log(
  "VALID SIGNATURE: PASS"
);

console.log(
  "TAMPER DETECTION: PASS"
);

console.log(
  "REPLAY PROTECTION: PASS"
);

console.log(
  "WRONG KEY REJECTED: PASS"
);

console.log(
  "MISSING SIGNATURE FAIL-CLOSED: PASS"
);

console.log(
  "NETWORK INGRESS: NONE"
);

console.log(
  "COCKPIT RUNTIME MUTATION: NONE"
);

console.log(
  "CALENDLY SUBSCRIPTION: NONE"
);
