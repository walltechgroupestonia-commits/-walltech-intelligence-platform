const fs = require("node:fs");
const path = require("node:path");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const DEFAULT_SCHEMA_PATH =
  "src/mail/response-state-evidence.schema.json";

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

const responseStatePath =
  process.argv[2];

const schemaPath =
  process.argv[3] ||
  DEFAULT_SCHEMA_PATH;

if (!responseStatePath) {
  console.error(
    "Usage: node src/mail/validate-response-state-evidence.js <response-state.json> [schema.json]"
  );

  process.exit(2);
}

const schema =
  loadJson(
    schemaPath,
    "SCHEMA"
  );

const responseState =
  loadJson(
    responseStatePath,
    "RESPONSE-STATE"
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

if (!validate(responseState)) {
  console.error(
    "RESPONSE-STATE EVIDENCE: INVALID"
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
  "RESPONSE-STATE EVIDENCE: VALID"
);

console.log(
  `RELATIONSHIPS: ${responseState.relationshipCount}`
);

for (
  const relationship of
  responseState.relationships
) {
  console.log(
    `OBSERVED STATE: ${relationship.observedState}`
  );

  console.log(
    `RESPONSE EXPECTATION: ${relationship.responseExpectationDetermination}`
  );

  console.log(
    `UNANSWERED: ${relationship.unansweredDetermination}`
  );

  console.log(
    `FOLLOW-UP: ${relationship.followUpDetermination}`
  );
}
