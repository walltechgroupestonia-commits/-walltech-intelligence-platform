const crypto = require("node:crypto");

const DEFAULT_TOLERANCE_SECONDS = 180;

function parseSignatureHeader(header) {
  if (!header || typeof header !== "string") {
    throw new Error(
      "CALENDLY WEBHOOK SIGNATURE HEADER MISSING"
    );
  }

  const parts = {};

  for (const item of header.split(",")) {
    const [key, ...rest] = item.split("=");

    if (!key || rest.length === 0) {
      continue;
    }

    parts[key.trim()] =
      rest.join("=").trim();
  }

  if (!parts.t || !parts.v1) {
    throw new Error(
      "CALENDLY WEBHOOK SIGNATURE HEADER INVALID"
    );
  }

  if (!/^[0-9]+$/.test(parts.t)) {
    throw new Error(
      "CALENDLY WEBHOOK TIMESTAMP INVALID"
    );
  }

  if (!/^[a-f0-9]{64}$/i.test(parts.v1)) {
    throw new Error(
      "CALENDLY WEBHOOK SIGNATURE INVALID"
    );
  }

  return {
    timestamp: Number(parts.t),
    signature: parts.v1.toLowerCase()
  };
}

function expectedSignature({
  signingKey,
  timestamp,
  rawBody
}) {
  if (!signingKey) {
    throw new Error(
      "CALENDLY WEBHOOK SIGNING KEY MISSING"
    );
  }

  if (!Buffer.isBuffer(rawBody)) {
    throw new Error(
      "CALENDLY WEBHOOK RAW BODY BUFFER REQUIRED"
    );
  }

  const signedPayload =
    `${timestamp}.${rawBody.toString("utf8")}`;

  return crypto
    .createHmac(
      "sha256",
      signingKey
    )
    .update(
      signedPayload,
      "utf8"
    )
    .digest("hex");
}

function timingSafeHexEqual(a, b) {
  const left =
    Buffer.from(a, "hex");

  const right =
    Buffer.from(b, "hex");

  if (
    left.length !== right.length ||
    left.length === 0
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    left,
    right
  );
}

function verifyCalendlyWebhookSignature({
  signatureHeader,
  signingKey,
  rawBody,
  nowMs = Date.now(),
  toleranceSeconds =
    DEFAULT_TOLERANCE_SECONDS
}) {
  const parsed =
    parseSignatureHeader(
      signatureHeader
    );

  const nowSeconds =
    Math.floor(nowMs / 1000);

  const ageSeconds =
    Math.abs(
      nowSeconds -
      parsed.timestamp
    );

  if (
    !Number.isFinite(
      toleranceSeconds
    ) ||
    toleranceSeconds < 0
  ) {
    throw new Error(
      "CALENDLY WEBHOOK TOLERANCE INVALID"
    );
  }

  if (
    ageSeconds >
    toleranceSeconds
  ) {
    return {
      valid: false,
      reason:
        "TIMESTAMP_OUTSIDE_TOLERANCE",
      timestamp:
        parsed.timestamp,
      ageSeconds
    };
  }

  const expected =
    expectedSignature({
      signingKey,
      timestamp:
        parsed.timestamp,
      rawBody
    });

  const valid =
    timingSafeHexEqual(
      expected,
      parsed.signature
    );

  return {
    valid,
    reason:
      valid
        ? "PASS"
        : "SIGNATURE_MISMATCH",
    timestamp:
      parsed.timestamp,
    ageSeconds
  };
}

module.exports = {
  DEFAULT_TOLERANCE_SECONDS,
  parseSignatureHeader,
  expectedSignature,
  verifyCalendlyWebhookSignature
};
