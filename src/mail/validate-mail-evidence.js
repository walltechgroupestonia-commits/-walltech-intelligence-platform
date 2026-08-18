const fs = require("node:fs");
const path = require("node:path");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const DEFAULT_SCHEMA_PATH =
  "src/mail/mail-evidence.schema.json";

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function loadJson(filePath, label) {
  const absolute = path.resolve(
    process.cwd(),
    filePath
  );

  if (!fs.existsSync(absolute)) {
    fail(
      `${label} NOT FOUND: ${filePath}`,
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
      `${label} INVALID JSON: ${filePath}\n${error.message}`,
      2
    );
  }
}

const evidencePath =
  process.argv[2];

const schemaPath =
  process.argv[3] ||
  DEFAULT_SCHEMA_PATH;

if (!evidencePath) {
  console.error(
    "Usage: node src/mail/validate-mail-evidence.js <mail-evidence.json> [schema.json]"
  );
  process.exit(2);
}

const schema = loadJson(
  schemaPath,
  "SCHEMA"
);

const evidence = loadJson(
  evidencePath,
  "MAIL EVIDENCE"
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

addFormats(ajv);

let validate;

try {
  validate = ajv.compile(schema);
} catch (error) {
  fail(
    `SCHEMA COMPILE ERROR:\n${error.message}`,
    3
  );
}

const valid = validate(evidence);

if (!valid) {
  console.error(
    "MAIL EVIDENCE: INVALID"
  );
  console.error(
    `FILE: ${evidencePath}`
  );
  console.error(
    JSON.stringify(
      validate.errors,
      null,
      2
    )
  );
  process.exit(1);
}

console.log("MAIL EVIDENCE: VALID");
console.log(`FILE: ${evidencePath}`);
console.log(
  `EVIDENCE ID: ${evidence.evidenceId}`
);
console.log(
  `MAILBOX: ${evidence.source.mailboxPath}`
);
console.log(
  `UIDVALIDITY: ${evidence.source.uidValidity}`
);
console.log(
  `UID: ${evidence.source.uid}`
);
