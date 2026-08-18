const fs = require("node:fs");
const path = require("node:path");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const DEFAULT_SCHEMA_PATH = "src/mail/communication-cycle.schema.json";

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function loadJson(filePath, label) {
  const absolutePath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    fail(`${label} NOT FOUND: ${filePath}`, 2);
  }

  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`${label} INVALID JSON: ${filePath}\n${error.message}`, 2);
  }
}

const communicationCyclePath = process.argv[2];
const schemaPath = process.argv[3] || DEFAULT_SCHEMA_PATH;

if (!communicationCyclePath) {
  console.error(
    "Usage: node src/mail/validate-communication-cycle.js <communication-cycle.json> [schema.json]"
  );
  process.exit(2);
}

const schema = loadJson(schemaPath, "SCHEMA");
const communicationCycle = loadJson(
  communicationCyclePath,
  "COMMUNICATION CYCLE"
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
  fail(`SCHEMA COMPILE ERROR:\n${error.message}`);
}

const valid = validate(communicationCycle);

if (!valid) {
  console.error("COMMUNICATION CYCLE: INVALID");
  console.error(`FILE: ${communicationCyclePath}`);
  console.error(JSON.stringify(validate.errors, null, 2));
  process.exit(1);
}

console.log("COMMUNICATION CYCLE: VALID");
console.log(`FILE: ${communicationCyclePath}`);

if (communicationCycle.dealId) {
  console.log(`DEAL: ${communicationCycle.dealId}`);
}

if (communicationCycle.status) {
  console.log(`STATUS: ${communicationCycle.status}`);
}

if (communicationCycle.nextAction) {
  console.log(`NEXT ACTION: ${communicationCycle.nextAction}`);
}
