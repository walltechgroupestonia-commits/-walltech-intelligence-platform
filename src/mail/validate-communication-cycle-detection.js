const fs = require("node:fs");
const path = require("node:path");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const DEFAULT_SCHEMA_PATH =
  "src/mail/communication-cycle-detection.schema.json";

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

const detectionPath =
  process.argv[2];

const schemaPath =
  process.argv[3] ||
  DEFAULT_SCHEMA_PATH;

if (!detectionPath) {
  console.error(
    "Usage: node src/mail/validate-communication-cycle-detection.js <detection.json> [schema.json]"
  );
  process.exit(2);
}

const schema =
  loadJson(
    schemaPath,
    "SCHEMA"
  );

const detection =
  loadJson(
    detectionPath,
    "DETECTION"
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

if (!validate(detection)) {
  console.error(
    "COMMUNICATION CYCLE DETECTION: INVALID"
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
  "COMMUNICATION CYCLE DETECTION: VALID"
);

console.log(
  `MESSAGES: ${detection.messageCount}`
);

console.log(
  `CANDIDATE RELATIONSHIPS: ${detection.candidateRelationshipCount}`
);
