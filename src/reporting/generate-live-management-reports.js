const fs = require("node:fs");
const path = require("node:path");

const {
  buildManagementCycleReports,
  writeManagementReportSet,
} = require(
  "./build-management-cycle-reports"
);

const {
  writeHtmlProduct,
} = require(
  "./render-management-report-html"
);

function loadJson(file) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    )
  );
}

function main() {
  const root =
    process.cwd();

  const registryPath =
    path.join(
      root,
      "runtime/state/collaborators/registry.json"
    );

  const cyclesDir =
    path.join(
      root,
      "runtime/state/communication-cycles"
    );

  const outputDir =
    path.join(
      root,
      "runtime/reports/management/current"
    );

  if (!fs.existsSync(registryPath)) {
    throw new Error(
      "COLLABORATOR REGISTRY NOT FOUND"
    );
  }

  if (!fs.existsSync(cyclesDir)) {
    throw new Error(
      "COMMUNICATION CYCLES DIRECTORY NOT FOUND"
    );
  }

  const registry =
    loadJson(
      registryPath
    );

  const collaborators =
    (registry.collaborators ?? [])
      .filter(
        item =>
          item.collaboratorId
      )
      .map(
        item => ({
          collaboratorId:
            item.collaboratorId,

          displayName:
            item.displayName ??
            item.name ??
            item.collaboratorId,
        })
      );

  const cycleFiles =
    fs.readdirSync(
      cyclesDir
    )
      .filter(
        file =>
          file.endsWith(".json")
      )
      .sort();

  const cycles =
    cycleFiles.map(
      file =>
        loadJson(
          path.join(
            cyclesDir,
            file
          )
        )
    );

  const input = {
    asOf:
      new Date().toISOString(),

    timeZone:
      "Europe/Tallinn",

    cycles,
    collaborators,
  };

  const result =
    buildManagementCycleReports(
      input
    );

  fs.rmSync(
    outputDir,
    {
      recursive: true,
      force: true,
    }
  );

  writeManagementReportSet(
    result,
    outputDir
  );

  writeHtmlProduct(
    result,
    outputDir
  );

  console.log(
    "LIVE MANAGEMENT REPORT PRODUCT: PASS"
  );

  console.log(
    `MASTER CYCLES: ${result.maxReport.counts.total}`
  );

  console.log(
    `COLLABORATOR REPORTS: ${result.collaboratorReports.length}`
  );

  for (
    const report
    of result.collaboratorReports
  ) {
    console.log(
      `REPORT: ${report.collaborator.displayName} | CYCLES: ${report.counts.total}`
    );
  }

  console.log(
    `OPEN: file://${path.join(outputDir, "index.html")}`
  );

  console.log(
    "EMAIL SEND: NONE"
  );

  console.log(
    "REPORT SEND: NONE"
  );
}

try {
  main();
} catch (error) {
  console.error(
    error.stack ||
    error.message
  );

  process.exitCode = 1;
}
