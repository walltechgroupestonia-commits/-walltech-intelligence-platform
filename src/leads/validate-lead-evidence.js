const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const Ajv2020Module = require("ajv/dist/2020");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const addFormatsModule = require("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;

const DEFAULT_SCHEMA =
  "src/leads/lead-evidence.schema.json";

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function expectedLeadId(source) {
  return (
    "LEAD-" +
    sha256(
      [
        "WALLTECH_LEAD_V1",
        source.provider,
        source.artifactType,
        source.submissionId
      ].join("\n")
    )
  );
}

function expectedEvidenceId(source) {
  return (
    "LE-" +
    sha256(
      [
        "WALLTECH_LEAD_EVIDENCE_V1",
        source.provider,
        source.artifactType,
        source.submissionId,
        source.updatedAt
      ].join("\n")
    )
  );
}

function compileValidator(schemaPath = DEFAULT_SCHEMA) {
  const schema = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), schemaPath),
      "utf8"
    )
  );

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });

  addFormats(ajv);

  return ajv.compile(schema);
}

function validateLeadEvidence(
  evidence,
  schemaPath = DEFAULT_SCHEMA
) {
  const validate = compileValidator(schemaPath);

  const schemaValid = validate(evidence);

  const errors = [];

  if (!schemaValid) {
    errors.push({
      type: "SCHEMA",
      details: validate.errors
    });
  }

  if (
    evidence?.source &&
    evidence.leadId !==
      expectedLeadId(evidence.source)
  ) {
    errors.push({
      type: "LEAD_ID_MISMATCH"
    });
  }

  if (
    evidence?.source &&
    evidence.evidenceId !==
      expectedEvidenceId(evidence.source)
  ) {
    errors.push({
      type: "EVIDENCE_ID_MISMATCH"
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function main() {
  const evidencePath = process.argv[2];

  if (!evidencePath) {
    console.error(
      "Usage: node src/leads/validate-lead-evidence.js <lead-evidence.json>"
    );
    process.exit(2);
  }

  const evidence = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), evidencePath),
      "utf8"
    )
  );

  const result =
    validateLeadEvidence(evidence);

  if (!result.valid) {
    console.error("LEAD EVIDENCE: INVALID");
    console.error(
      JSON.stringify(result.errors, null, 2)
    );
    process.exit(1);
  }

  console.log("LEAD EVIDENCE: VALID");
  console.log(`LEAD: ${evidence.leadId}`);
  console.log(`EVIDENCE: ${evidence.evidenceId}`);
}

module.exports = {
  expectedLeadId,
  expectedEvidenceId,
  validateLeadEvidence
};

if (require.main === module) {
  main();
}
