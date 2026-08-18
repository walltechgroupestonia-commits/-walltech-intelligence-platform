const fs = require("node:fs");
const path = require("node:path");

const Ajv2020Module =
  require("ajv/dist/2020");

const Ajv2020 =
  Ajv2020Module.default ||
  Ajv2020Module;

const addFormatsModule =
  require("ajv-formats");

const addFormats =
  addFormatsModule.default ||
  addFormatsModule;

const DEFAULT_SCHEMA =
  "src/mail/relationship-response-expectation.schema.json";

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
  DEFAULT_SCHEMA;

if (!evidencePath) {
  console.error(
    "Usage: node src/mail/validate-relationship-response-expectation.js <relationship-expectation.json> [schema.json]"
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
    "RELATIONSHIP RESPONSE EXPECTATION"
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
    "RELATIONSHIP RESPONSE EXPECTATION: INVALID"
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
  "RELATIONSHIP RESPONSE EXPECTATION: VALID"
);

console.log(
  `RELATIONSHIPS: ${evidence.relationshipCount}`
);

for (
  const item of
  evidence.relationships
) {
  console.log(
    `DETERMINATION: ${item.relationshipDetermination}`
  );

  console.log(
    `ESTABLISHED EXPECTATIONS: ${item.establishedExpectationCount}`
  );

  console.log(
    `OPEN EXPECTATIONS: ${item.openExpectationCount}`
  );

  console.log(
    `LATER RESPONSES OBSERVED: ${item.laterResponseObservedCount}`
  );
}
