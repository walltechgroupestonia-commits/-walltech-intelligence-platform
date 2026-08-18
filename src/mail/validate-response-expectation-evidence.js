const fs = require("node:fs");
const path = require("node:path");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 =
  Ajv2020Module.default || Ajv2020Module;

const addFormatsModule =
  require("ajv-formats");

const addFormats =
  addFormatsModule.default || addFormatsModule;

const DEFAULT_SCHEMA_PATH =
  "src/mail/response-expectation-evidence.schema.json";

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function loadJson(filePath, label) {
  const absolute =
    path.resolve(
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
    "Usage: node src/mail/validate-response-expectation-evidence.js <response-expectation.json> [schema.json]"
  );

  process.exit(2);
}

const schema =
  loadJson(
    schemaPath,
    "SCHEMA"
  );

const evidence =
  loadJson(
    evidencePath,
    "RESPONSE EXPECTATION EVIDENCE"
  );

const ajv =
  new Ajv2020({
    allErrors: true,
    strict: true,
  });

addFormats(ajv);

let validate;

try {
  validate =
    ajv.compile(schema);
} catch (error) {
  fail(
    `SCHEMA COMPILE ERROR:\n${error.message}`,
    3
  );
}

if (!validate(evidence)) {
  console.error(
    "RESPONSE EXPECTATION EVIDENCE: INVALID"
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

console.log(
  "RESPONSE EXPECTATION EVIDENCE: VALID"
);

console.log(
  `DIRECTION: ${evidence.message.direction}`
);

console.log(
  `SIGNALS: ${evidence.explicitSignalCount}`
);

console.log(
  `DETERMINATION: ${evidence.determination}`
);

console.log(
  `EXPECTED RESPONDER: ${evidence.expectedResponder}`
);
