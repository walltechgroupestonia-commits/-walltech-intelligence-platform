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
  "src/mail/commercial-communication-interpretation.schema.json";

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
    "Usage: node src/mail/validate-commercial-communication-interpretation.js <cci.json> [schema.json]"
  );
  process.exit(2);
}

const schema =
  loadJson(
    schemaPath,
    "CCI SCHEMA"
  );

const cci =
  loadJson(
    evidencePath,
    "COMMERCIAL COMMUNICATION INTERPRETATION"
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
    `CCI SCHEMA COMPILE ERROR:\n${error.message}`,
    3
  );
}

if (!validate(cci)) {
  console.error(
    "COMMERCIAL COMMUNICATION INTERPRETATION: INVALID"
  );

  console.error(
    JSON.stringify(
      validate.errors,
      null,
      2
    )
  );

  process.exit(4);
}

/*
 * Cross-field semantic gates.
 */

if (
  cci.signalCount !==
  cci.signals.length
) {
  fail(
    "CCI SEMANTIC ERROR: signalCount mismatch",
    5
  );
}

if (
  cci.productReferenceCount !==
  cci.productReferences.length
) {
  fail(
    "CCI SEMANTIC ERROR: productReferenceCount mismatch",
    5
  );
}

if (
  cci.actionDirectiveCount !==
  cci.actionDirectives.length
) {
  fail(
    "CCI SEMANTIC ERROR: actionDirectiveCount mismatch",
    5
  );
}

if (
  cci.commercialStateMutation !==
  "NONE"
) {
  fail(
    "CCI SAFETY ERROR: commercial state mutation attempted",
    6
  );
}

if (
  cci.actionDirectiveCount > 0 &&
  cci.nextActorDetermination ===
    "NONE"
) {
  fail(
    "CCI SEMANTIC ERROR: action directive exists but next actor is NONE",
    5
  );
}

console.log(
  "COMMERCIAL COMMUNICATION INTERPRETATION: VALID"
);

console.log(
  `CCI ID: ${cci.commercialCommunicationInterpretationId}`
);

console.log(
  `UID: ${cci.source.uid}`
);

console.log(
  `SIGNALS: ${cci.signalCount}`
);

console.log(
  `PRODUCT REFERENCES: ${cci.productReferenceCount}`
);

console.log(
  `ACTION DIRECTIVES: ${cci.actionDirectiveCount}`
);

console.log(
  `NEXT ACTOR: ${cci.nextActorDetermination}`
);

console.log(
  `DEAL IMPACT: ${cci.dealImpact}`
);

console.log(
  `STATE MUTATION: ${cci.commercialStateMutation}`
);

console.log(
  "CCI SAFETY GATE: PASS"
);
