const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PostalMimeModule = require("postal-mime");
const PostalMime = PostalMimeModule.default || PostalMimeModule;

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function sha256(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function toBuffer(content) {
  if (content === undefined || content === null) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(content)) {
    return content;
  }

  if (content instanceof ArrayBuffer) {
    return Buffer.from(content);
  }

  if (ArrayBuffer.isView(content)) {
    return Buffer.from(
      content.buffer,
      content.byteOffset,
      content.byteLength
    );
  }

  if (typeof content === "string") {
    return Buffer.from(content, "utf8");
  }

  throw new TypeError(
    `Unsupported attachment content type: ${typeof content}`
  );
}

function normalizeMailbox(address) {
  if (!address || typeof address !== "object") {
    return null;
  }

  if (Array.isArray(address.group)) {
    return {
      name: address.name || null,
      address: address.address || null,
      group: address.group
        .map(normalizeMailbox)
        .filter(Boolean),
    };
  }

  return {
    name: address.name || null,
    address: address.address || null,
  };
}

function normalizeAddressList(value) {
  if (!value) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];

  return list
    .map(normalizeMailbox)
    .filter(Boolean);
}

function normalizeReferences(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return [value];
}

function normalizeAttachment(attachment, index) {
  const content = toBuffer(attachment.content);

  return {
    index,
    filename: attachment.filename || null,
    mimeType: attachment.mimeType || null,
    disposition: attachment.disposition || null,
    related: attachment.related === true,
    contentId: attachment.contentId || null,
    description: attachment.description || null,

    sizeBytes: content.length,
    sha256: sha256(content),

    /*
     * Attachment binary content is deliberately NOT copied into
     * the normalized JSON object.
     */
    contentStored: false,
  };
}

async function normalizeRfc822(inputPath) {
  const absoluteInput = path.resolve(
    process.cwd(),
    inputPath
  );

  if (!fs.existsSync(absoluteInput)) {
    fail(`RFC822 SOURCE NOT FOUND: ${inputPath}`, 2);
  }

  const raw = fs.readFileSync(absoluteInput);

  if (raw.length === 0) {
    fail(`RFC822 SOURCE EMPTY: ${inputPath}`, 2);
  }

  const rawSha256 = sha256(raw);

  let parsed;

  try {
    parsed = await PostalMime.parse(
      raw,
      {
        attachmentEncoding: "arraybuffer",
        maxNestingDepth: 64,
        maxHeadersSize: 2097152,
      }
    );
  } catch (error) {
    fail(
      `RFC822 PARSE FAILED: ${error.message}`,
      3
    );
  }

  const text =
    typeof parsed.text === "string"
      ? parsed.text
      : null;

  const html =
    typeof parsed.html === "string"
      ? parsed.html
      : null;

  const textBuffer =
    text === null
      ? Buffer.alloc(0)
      : Buffer.from(text, "utf8");

  const htmlBuffer =
    html === null
      ? Buffer.alloc(0)
      : Buffer.from(html, "utf8");

  const attachments = Array.isArray(parsed.attachments)
    ? parsed.attachments.map(normalizeAttachment)
    : [];

  return {
    normalizationVersion: "1.0",
    normalizationType: "RFC822_NORMALIZED_CONTENT",

    rawEvidence: {
      sourcePath: absoluteInput,
      sourceBytes: raw.length,
      sourceSha256: rawSha256,
    },

    identity: {
      messageId: parsed.messageId || null,
      inReplyTo: parsed.inReplyTo || null,
      references: normalizeReferences(parsed.references),
      date: parsed.date || null,
      subject: parsed.subject || null,
    },

    participants: {
      from: normalizeAddressList(parsed.from),
      sender: normalizeAddressList(parsed.sender),
      to: normalizeAddressList(parsed.to),
      cc: normalizeAddressList(parsed.cc),
      bcc: normalizeAddressList(parsed.bcc),
      replyTo: normalizeAddressList(parsed.replyTo),
    },

    content: {
      text,
      html,

      textPresent:
        typeof text === "string" &&
        text.length > 0,

      htmlPresent:
        typeof html === "string" &&
        html.length > 0,

      textCharacters:
        text ? text.length : 0,

      htmlCharacters:
        html ? html.length : 0,

      textBytes: textBuffer.length,
      htmlBytes: htmlBuffer.length,

      textSha256:
        textBuffer.length > 0
          ? sha256(textBuffer)
          : null,

      htmlSha256:
        htmlBuffer.length > 0
          ? sha256(htmlBuffer)
          : null,
    },

    attachmentCount: attachments.length,
    attachments,

    headerCount: Array.isArray(parsed.headers)
      ? parsed.headers.length
      : 0,

    normalizedAt: new Date().toISOString(),
  };
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || null;

  if (!inputPath) {
    console.error(
      "Usage: node src/mail/normalize-rfc822-message.js <message.eml> [normalized.json]"
    );
    process.exit(2);
  }

  const normalized = await normalizeRfc822(
    inputPath
  );

  const json =
    JSON.stringify(normalized, null, 2) + "\n";

  if (outputPath) {
    const absoluteOutput = path.resolve(
      process.cwd(),
      outputPath
    );

    fs.mkdirSync(
      path.dirname(absoluteOutput),
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
  console.error("RFC822 NORMALIZATION: PASS");
  console.error(
    `MESSAGE-ID: ${normalized.identity.messageId}`
  );
  console.error(
    `SUBJECT: ${normalized.identity.subject}`
  );
  console.error(
    `RAW BYTES: ${normalized.rawEvidence.sourceBytes}`
  );
  console.error(
    `RAW SHA256: ${normalized.rawEvidence.sourceSha256}`
  );
  console.error(
    `TEXT: ${normalized.content.textPresent} / ${normalized.content.textCharacters} chars`
  );
  console.error(
    `HTML: ${normalized.content.htmlPresent} / ${normalized.content.htmlCharacters} chars`
  );
  console.error(
    `ATTACHMENTS: ${normalized.attachmentCount}`
  );
}

main().catch((error) => {
  console.error("");
  console.error("RFC822 NORMALIZATION: FAILED");
  console.error(error?.message || error);
  process.exit(1);
});
