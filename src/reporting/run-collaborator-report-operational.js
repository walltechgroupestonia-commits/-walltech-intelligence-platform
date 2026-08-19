const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  spawnSync,
} = require("node:child_process");

const {
  validateCollaboratorReportOperationalRunInput,
} = require(
  "./validate-collaborator-report-operational-run-input.js"
);

const {
  buildCollaboratorReportFromEvidence,
} = require(
  "./build-collaborator-report-from-evidence.js"
);

function loadJson(
  filePath,
  label,
) {
  const absolutePath =
    path.resolve(
      process.cwd(),
      filePath,
    );

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    throw new Error(
      `${label} NOT FOUND: ${filePath}`,
    );
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        absolutePath,
        "utf8",
      ),
    );
  } catch (error) {
    throw new Error(
      `${label} INVALID JSON: ${filePath}\n${error.message}`,
    );
  }
}

function runNode(
  args,
) {
  const result =
    spawnSync(
      process.execPath,
      args,
      {
        cwd:
          process.cwd(),

        env:
          process.env,

        encoding:
          "utf8",
      },
    );

  if (
    result.stderr
  ) {
    process.stderr.write(
      result.stderr,
    );
  }

  if (
    result.status !== 0
  ) {
    const stdout =
      result.stdout
        ? `\n${result.stdout}`
        : "";

    throw new Error(
      `CHILD PROCESS FAILED (${result.status}): node ${args.join(" ")}${stdout}`,
    );
  }

  return result;
}

function readEvidenceFile(
  evidencePath,
  expectedUid,
  expectedMailboxPath,
) {
  const evidence =
    loadJson(
      evidencePath,
      `MAIL EVIDENCE UID ${expectedUid}`,
    );

  if (
    evidence.evidenceType !==
    "MAIL_EVIDENCE"
  ) {
    throw new Error(
      `ACQUIRED EVIDENCE TYPE MISMATCH FOR UID ${expectedUid}`,
    );
  }

  if (
    evidence.source.uid !==
    expectedUid
  ) {
    throw new Error(
      `ACQUIRED UID MISMATCH: requested ${expectedUid}, evidence ${evidence.source.uid}`,
    );
  }

  if (
    evidence.source.mailboxPath !==
    expectedMailboxPath
  ) {
    throw new Error(
      `ACQUIRED MAILBOX MISMATCH FOR UID ${expectedUid}: requested ${expectedMailboxPath}, evidence ${evidence.source.mailboxPath}`,
    );
  }

  return evidence;
}

function buildUidToEvidenceIdMap(
  evidenceRecords,
) {
  const uidToEvidenceId =
    new Map();

  const evidenceIds =
    new Set();

  for (
    const evidence
    of evidenceRecords
  ) {
    const uid =
      evidence.source.uid;

    const evidenceId =
      evidence.evidenceId;

    if (
      uidToEvidenceId.has(
        uid,
      )
    ) {
      throw new Error(
        `DUPLICATE ACQUIRED UID: ${uid}`,
      );
    }

    if (
      evidenceIds.has(
        evidenceId,
      )
    ) {
      throw new Error(
        `DUPLICATE ACQUIRED EVIDENCE ID: ${evidenceId}`,
      );
    }

    uidToEvidenceId.set(
      uid,
      evidenceId,
    );

    evidenceIds.add(
      evidenceId,
    );
  }

  return uidToEvidenceId;
}

function mapAuthoritativeBindings(
  authoritativeUidBindings,
  uidToEvidenceId,
) {
  return authoritativeUidBindings
    .map(
      binding => {
        const evidenceRef =
          uidToEvidenceId.get(
            binding.uid,
          );

        if (
          !evidenceRef
        ) {
          throw new Error(
            `AUTHORITATIVE UID HAS NO ACQUIRED EVIDENCE: ${binding.uid}`,
          );
        }

        return {
          evidenceRef,

          opportunityId:
            binding.opportunityId,

          bindingSource:
            binding.bindingSource,
        };
      },
    )
    .sort(
      (a, b) =>
        a.evidenceRef.localeCompare(
          b.evidenceRef,
        ) ||
        a.opportunityId.localeCompare(
          b.opportunityId,
        ) ||
        a.bindingSource.localeCompare(
          b.bindingSource,
        ),
    );
}

function mapOpportunityHints(
  opportunityUidHints,
  uidToEvidenceId,
) {
  return opportunityUidHints
    .map(
      hint => {
        const evidenceId =
          uidToEvidenceId.get(
            hint.uid,
          );

        if (
          !evidenceId
        ) {
          throw new Error(
            `OPPORTUNITY HINT UID HAS NO ACQUIRED EVIDENCE: ${hint.uid}`,
          );
        }

        return {
          evidenceId,

          opportunityId:
            hint.opportunityId,

          matchBasis:
            hint.matchBasis,
        };
      },
    )
    .sort(
      (a, b) =>
        a.evidenceId.localeCompare(
          b.evidenceId,
        ) ||
        a.opportunityId.localeCompare(
          b.opportunityId,
        ) ||
        a.matchBasis.localeCompare(
          b.matchBasis,
        ),
    );
}

function parseDetectionStdout(
  stdout,
) {
  try {
    return JSON.parse(
      stdout,
    );
  } catch (error) {
    throw new Error(
      `COMMUNICATION DETECTION INVALID JSON\n${error.message}`,
    );
  }
}

function acquireEvidenceRecords(
  input,
  tempRoot,
  runNodeFn = runNode,
) {
  const records = [];

  const sortedUids =
    [...input.uids]
      .sort(
        (a, b) =>
          a - b,
      );

  for (
    const uid
    of sortedUids
  ) {
    const evidencePath =
      path.join(
        tempRoot,
        `uid-${uid}-evidence.json`,
      );

    runNodeFn([
      "src/mail/acquire-mail-evidence.js",
      input.accountLookup,
      input.mailboxPath,
      String(uid),
      evidencePath,
    ]);

    records.push(
      readEvidenceFile(
        evidencePath,
        uid,
        input.mailboxPath,
      ),
    );
  }

  return records;
}

function detectCommunication(
  evidenceRecords,
  tempRoot,
  runNodeFn = runNode,
) {
  const evidencePaths =
    evidenceRecords.map(
      evidence =>
        path.join(
          tempRoot,
          `uid-${evidence.source.uid}-evidence.json`,
        ),
    );

  const detectionResult =
    runNodeFn([
      "src/mail/detect-communication-cycle-candidates.js",
      ...evidencePaths,
    ]);

  return parseDetectionStdout(
    detectionResult.stdout,
  );
}

function buildAdapterInputFromOperationalRun(
  operationalInput,
  mailEvidence,
  communicationDetection,
) {
  const uidToEvidenceId =
    buildUidToEvidenceIdMap(
      mailEvidence,
    );

  return {
    adapterVersion:
      "1.0",

    adapterType:
      "MAIL_EVIDENCE_TO_COLLABORATOR_RECONCILIATION_INPUT",

    adapterPolicy:
      "EXACT_IDENTITY_FAIL_CLOSED_NO_BUSINESS_INFERENCE_V1",

    reportId:
      operationalInput.reportId,

    mailEvidence,

    communicationDetection,

    collaboratorDirectory:
      operationalInput.collaboratorDirectory,

    knownEvidence:
      operationalInput.knownEvidence,

    /*
     * Exact technical translation only:
     * explicitly supplied UID → acquired MailEvidence ID.
     */
    authoritativeBindings:
      mapAuthoritativeBindings(
        operationalInput.authoritativeUidBindings,
        uidToEvidenceId,
      ),

    /*
     * Still non-authoritative.
     * UID is only a mailbox coordinate, never business inference.
     */
    opportunityHints:
      mapOpportunityHints(
        operationalInput.opportunityUidHints,
        uidToEvidenceId,
      ),
  };
}

function runOperationalCollaboratorReport(
  operationalInput,
  dependencies = {},
) {
  /*
   * CRITICAL ORDERING:
   * validate the full run contract before any mailbox child
   * process can be invoked.
   */
  validateCollaboratorReportOperationalRunInput(
    operationalInput,
  );

  const runNodeFn =
    dependencies.runNodeFn ??
    runNode;

  const tempRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "walltech-collaborator-report-",
      ),
    );

  try {
    const mailEvidence =
      acquireEvidenceRecords(
        operationalInput,
        tempRoot,
        runNodeFn,
      );

    if (
      mailEvidence.length !==
      operationalInput.uids.length
    ) {
      throw new Error(
        `ACQUISITION COUNT MISMATCH: requested ${operationalInput.uids.length}, acquired ${mailEvidence.length}`,
      );
    }

    const communicationDetection =
      detectCommunication(
        mailEvidence,
        tempRoot,
        runNodeFn,
      );

    const adapterInput =
      buildAdapterInputFromOperationalRun(
        operationalInput,
        mailEvidence,
        communicationDetection,
      );

    return buildCollaboratorReportFromEvidence(
      adapterInput,
    );
  } finally {
    fs.rmSync(
      tempRoot,
      {
        recursive: true,
        force: true,
      },
    );

    if (
      fs.existsSync(
        tempRoot,
      )
    ) {
      throw new Error(
        `OPERATIONAL RUN TEMP CLEANUP FAILED: ${tempRoot}`,
      );
    }
  }
}

function main() {
  const inputPath =
    process.argv[2];

  const outputPath =
    process.argv[3] ??
    null;

  if (!inputPath) {
    console.error(
      "Usage: node src/reporting/run-collaborator-report-operational.js <operational-run-input.json> [report-output.json]",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const input =
      loadJson(
        inputPath,
        "COLLABORATOR REPORT OPERATIONAL RUN INPUT",
      );

    const result =
      runOperationalCollaboratorReport(
        input,
      );

    const json =
      `${JSON.stringify(
        result,
        null,
        2,
      )}\n`;

    if (
      outputPath
    ) {
      const absoluteOutput =
        path.resolve(
          process.cwd(),
          outputPath,
        );

      fs.mkdirSync(
        path.dirname(
          absoluteOutput,
        ),
        {
          recursive: true,
        },
      );

      fs.writeFileSync(
        absoluteOutput,
        json,
      );

      console.log(
        "COLLABORATOR REPORT OPERATIONAL RUN: PASS",
      );

      console.log(
        `REPORT: ${result.reportId}`,
      );

      console.log(
        `ORCHESTRATION ID: ${result.orchestrationId}`,
      );

      console.log(
        `INPUT EVENTS: ${result.reconciliation.counts.inputEvents}`,
      );

      console.log(
        `INCLUDED ROWS: ${result.reportGeneration.counts.includedRows}`,
      );

      console.log(
        "BUSINESS INFERENCE: NONE",
      );

      console.log(
        "CRM / COMMERCIAL MUTATION: NONE",
      );

      return;
    }

    process.stdout.write(
      json,
    );
  } catch (error) {
    console.error(
      error.message,
    );

    process.exitCode = 1;
  }
}

if (
  require.main === module
) {
  main();
}

module.exports = {
  runNode,
  readEvidenceFile,
  buildUidToEvidenceIdMap,
  mapAuthoritativeBindings,
  mapOpportunityHints,
  parseDetectionStdout,
  acquireEvidenceRecords,
  detectCommunication,
  buildAdapterInputFromOperationalRun,
  runOperationalCollaboratorReport,
};
