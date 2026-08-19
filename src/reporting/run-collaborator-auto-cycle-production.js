const crypto =
  require("node:crypto");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const {
  canonicalJson,
  writeAtomically,
} = require(
  "../mail/commit-mailbox-processing-cursor.js"
);

const {
  runCollaboratorAutoCycle,
} = require(
  "./run-collaborator-auto-cycle.js"
);

const REPO_ROOT =
  path.resolve(
    __dirname,
    "../..",
  );

const EXIT_CODES =
  Object.freeze({
    SUCCESS:
      0,

    FAILURE:
      1,

    BLOCKED:
      10,

    LOCKED:
      20,
  });

const PRODUCTION_CONFIG =
  Object.freeze({
    mode:
      "COMMIT",

    profilePath:
      path.join(
        REPO_ROOT,
        "runtime/profiles/collaborators/quectel.json",
      ),

    cursorPath:
      path.join(
        REPO_ROOT,
        "runtime/state/mailboxes/info-inbox-cursor.json",
      ),

    reportOutputDir:
      path.join(
        REPO_ROOT,
        "runtime/reports/collaborators",
      ),

    auditRoot:
      path.join(
        REPO_ROOT,
        "runtime/audit/collaborator-auto-cycle",
      ),

    lockDir:
      path.join(
        REPO_ROOT,
        "runtime/locks/collaborator-auto-cycle.lock",
      ),

    launcherLogPath:
      path.join(
        REPO_ROOT,
        "runtime/logs/collaborator-auto-cycle/launcher.jsonl",
      ),

    launcherLatestPath:
      path.join(
        REPO_ROOT,
        "runtime/logs/collaborator-auto-cycle/latest.json",
      ),
  });

function isProcessAlive(
  pid,
) {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0
  ) {
    return false;
  }

  try {
    process.kill(
      pid,
      0,
    );

    return true;
  } catch (error) {
    if (
      error &&
      error.code === "ESRCH"
    ) {
      return false;
    }

    /*
     * EPERM or an unknown OS response means:
     * fail closed and assume the owner exists.
     */
    return true;
  }
}

function readLockOwner(
  lockDir,
) {
  const ownerPath =
    path.join(
      lockDir,
      "owner.json",
    );

  try {
    return JSON.parse(
      fs.readFileSync(
        ownerPath,
        "utf8",
      ),
    );
  } catch {
    return null;
  }
}

function quarantineStaleLock(
  lockDir,
) {
  const quarantine =
    `${lockDir}.stale-${crypto.randomUUID()}`;

  fs.renameSync(
    lockDir,
    quarantine,
  );

  fs.rmSync(
    quarantine,
    {
      recursive: true,
      force: true,
    },
  );
}

function acquireSingleInstanceLock(
  lockDir,
) {
  fs.mkdirSync(
    path.dirname(
      lockDir,
    ),
    {
      recursive: true,
    },
  );

  for (
    let attempt = 0;
    attempt < 3;
    attempt += 1
  ) {
    try {
      fs.mkdirSync(
        lockDir,
        {
          mode: 0o700,
        },
      );

      const owner = {
        lockVersion:
          "1.0",

        lockType:
          "COLLABORATOR_AUTO_CYCLE_PRODUCTION_LOCK",

        token:
          crypto.randomUUID(),

        pid:
          process.pid,

        hostname:
          os.hostname(),

        startedAt:
          new Date().toISOString(),
      };

      try {
        fs.writeFileSync(
          path.join(
            lockDir,
            "owner.json",
          ),
          canonicalJson(
            owner,
          ),
          {
            encoding:
              "utf8",

            flag:
              "wx",

            mode:
              0o600,
          },
        );
      } catch (error) {
        fs.rmSync(
          lockDir,
          {
            recursive: true,
            force: true,
          },
        );

        throw error;
      }

      return {
        acquired:
          true,

        lockDir,

        owner,
      };
    } catch (error) {
      if (
        !error ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }

      const owner =
        readLockOwner(
          lockDir,
        );

      /*
       * Unknown/corrupt owner:
       * never delete automatically.
       */
      if (!owner) {
        return {
          acquired:
            false,

          reason:
            "LOCK_OWNER_UNKNOWN",

          owner:
            null,
        };
      }

      const sameHost =
        owner.hostname ===
        os.hostname();

      const alive =
        sameHost
          ? isProcessAlive(
              owner.pid,
            )
          : true;

      if (alive) {
        return {
          acquired:
            false,

          reason:
            "INSTANCE_ALREADY_RUNNING",

          owner,
        };
      }

      /*
       * Stale lock from a dead process on this host.
       *
       * Rename is used instead of deleting the
       * original path directly. This prevents a
       * stale-lock cleanup race from deleting a
       * newly acquired lock belonging to another
       * process.
       */
      try {
        quarantineStaleLock(
          lockDir,
        );
      } catch (renameError) {
        if (
          renameError &&
          renameError.code === "ENOENT"
        ) {
          continue;
        }

        throw renameError;
      }
    }
  }

  return {
    acquired:
      false,

    reason:
      "LOCK_ACQUISITION_RETRY_EXHAUSTED",

    owner:
      readLockOwner(
        lockDir,
      ),
  };
}

function releaseSingleInstanceLock(
  lock,
) {
  if (
    !lock ||
    lock.acquired !== true
  ) {
    return;
  }

  const current =
    readLockOwner(
      lock.lockDir,
    );

  if (
    !current ||
    current.token !==
    lock.owner.token
  ) {
    throw new Error(
      "LOCK OWNERSHIP CHANGED BEFORE RELEASE",
    );
  }

  fs.rmSync(
    lock.lockDir,
    {
      recursive: true,
      force: true,
    },
  );
}

function classifyCycleResult(
  cycle,
) {
  if (
    !cycle ||
    typeof cycle !== "object"
  ) {
    throw new Error(
      "AUTO CYCLE RESULT MISSING",
    );
  }

  if (
    cycle.mode !==
    "COMMIT"
  ) {
    throw new Error(
      `PRODUCTION CYCLE MUST USE COMMIT MODE: ${cycle.mode}`,
    );
  }

  switch (
    cycle.status
  ) {
    case "NO_NEW_MESSAGES":
      return {
        resultClass:
          "NO_NEW",

        exitCode:
          EXIT_CODES.SUCCESS,
      };

    case "REPORT_COMMITTED":
    case "HANDLED_NO_REPORT":
    case "COMPLETED":
      return {
        resultClass:
          "PROCESSED",

        exitCode:
          EXIT_CODES.SUCCESS,
      };

    case "PARTIAL_ADVANCE_REVIEW_REQUIRED":
    case "BLOCKED_REVIEW_REQUIRED":
    case "PARTIAL_ADVANCE_PROCESSING_FAILED":
    case "BLOCKED_PROCESSING_FAILED":
      return {
        resultClass:
          "BLOCKED",

        exitCode:
          EXIT_CODES.BLOCKED,
      };

    default:
      throw new Error(
        `UNKNOWN PRODUCTION CYCLE STATUS: ${cycle.status}`,
      );
  }
}

function buildLauncherRecord(
  {
    resultClass,
    exitCode,
    startedAt,
    finishedAt,
    cycle = null,
    error = null,
    lock = null,
  },
) {
  return {
    launcherVersion:
      "1.0",

    launcherType:
      "COLLABORATOR_AUTO_CYCLE_PRODUCTION_LAUNCHER",

    launcherPolicy:
      "SINGLE_INSTANCE_FIXED_COMMIT_RUNTIME_PATHS_V1",

    resultClass,

    exitCode,

    startedAt,

    finishedAt,

    cycleId:
      cycle?.cycleId ??
      null,

    cycleStatus:
      cycle?.status ??
      null,

    discoveredUids:
      cycle?.discoveredUids ??
      [],

    processingUids:
      cycle?.processingUids ??
      [],

    deferredEligibleUids:
      cycle?.deferredEligibleUids ??
      [],

    reportId:
      cycle?.report?.reportId ??
      null,

    cursorBoundaryBefore:
      cycle?.cursorBoundaryBefore ??
      null,

    cursorBoundaryAfter:
      cycle?.cursorBoundaryAfter ??
      null,

    cursorMutation:
      cycle?.cursorMutation ??
      false,

    lockOwner:
      lock?.owner ??
      null,

    error:
      error === null
        ? null
        : String(error),
  };
}

function persistLauncherRecord(
  config,
  record,
) {
  fs.mkdirSync(
    path.dirname(
      config.launcherLogPath,
    ),
    {
      recursive: true,
    },
  );

  fs.appendFileSync(
    config.launcherLogPath,
    `${JSON.stringify(
      record,
    )}\n`,
    "utf8",
  );

  writeAtomically(
    config.launcherLatestPath,
    canonicalJson(
      record,
    ),
  );
}

async function runProductionLauncher(
  config =
    PRODUCTION_CONFIG,
  dependencies = {},
) {
  if (
    config.mode !==
    "COMMIT"
  ) {
    throw new Error(
      "PRODUCTION LAUNCHER CONFIG MUST BE COMMIT",
    );
  }

  const startedAt =
    new Date().toISOString();

  const acquireLockFn =
    dependencies.acquireSingleInstanceLockFn ??
    acquireSingleInstanceLock;

  const releaseLockFn =
    dependencies.releaseSingleInstanceLockFn ??
    releaseSingleInstanceLock;

  const runCycleFn =
    dependencies.runCollaboratorAutoCycleFn ??
    runCollaboratorAutoCycle;

  const persistFn =
    dependencies.persistLauncherRecordFn ??
    persistLauncherRecord;

  const lock =
    acquireLockFn(
      config.lockDir,
    );

  if (
    !lock.acquired
  ) {
    const record =
      buildLauncherRecord({
        resultClass:
          "LOCKED",

        exitCode:
          EXIT_CODES.LOCKED,

        startedAt,

        finishedAt:
          new Date().toISOString(),

        error:
          lock.reason,

        lock,
      });

    persistFn(
      config,
      record,
    );

    return record;
  }

  let record;

  try {
    const cycle =
      await runCycleFn({
        profilePath:
          config.profilePath,

        cursorPath:
          config.cursorPath,

        mode:
          "COMMIT",

        reportOutputDir:
          config.reportOutputDir,

        auditRoot:
          config.auditRoot,
      });

    const classification =
      classifyCycleResult(
        cycle,
      );

    record =
      buildLauncherRecord({
        ...classification,

        startedAt,

        finishedAt:
          new Date().toISOString(),

        cycle,

        lock,
      });
  } catch (error) {
    record =
      buildLauncherRecord({
        resultClass:
          "FAILURE",

        exitCode:
          EXIT_CODES.FAILURE,

        startedAt,

        finishedAt:
          new Date().toISOString(),

        error:
          error?.message ??
          error,

        lock,
      });
  }

  /*
   * Persist while lock is still held.
   * Therefore the log corresponds to the exact
   * single-instance execution being released.
   */
  try {
    persistFn(
      config,
      record,
    );
  } catch (error) {
    record = {
      ...record,

      resultClass:
        "FAILURE",

      exitCode:
        EXIT_CODES.FAILURE,

      error:
        `LAUNCHER LOG PERSISTENCE FAILED: ${
          error?.message ??
          error
        }`,
    };
  }

  try {
    releaseLockFn(
      lock,
    );
  } catch (error) {
    record = {
      ...record,

      resultClass:
        "FAILURE",

      exitCode:
        EXIT_CODES.FAILURE,

      error:
        `LOCK RELEASE FAILED: ${
          error?.message ??
          error
        }`,
    };
  }

  return record;
}

async function main() {
  /*
   * Production interface deliberately accepts
   * no operational arguments.
   */
  if (
    process.argv.length > 2
  ) {
    console.error(
      "PRODUCTION LAUNCHER ACCEPTS NO ARGUMENTS",
    );

    process.exitCode =
      2;

    return;
  }

  let result;

  try {
    result =
      await runProductionLauncher();
  } catch (error) {
    console.error(
      "COLLABORATOR PRODUCTION LAUNCHER: FAILURE",
    );

    console.error(
      error?.message ??
      error,
    );

    process.exitCode =
      EXIT_CODES.FAILURE;

    return;
  }

  console.log(
    "COLLABORATOR PRODUCTION LAUNCHER: COMPLETE",
  );

  console.log(
    `LAUNCH RESULT: ${result.resultClass}`,
  );

  console.log(
    `EXIT CODE: ${result.exitCode}`,
  );

  console.log(
    `CYCLE STATUS: ${result.cycleStatus ?? "NONE"}`,
  );

  console.log(
    `CYCLE ID: ${result.cycleId ?? "NONE"}`,
  );

  console.log(
    `DISCOVERED UIDS: ${
      result.discoveredUids.length
        ? result.discoveredUids.join(",")
        : "NONE"
    }`,
  );

  console.log(
    `PROCESSING UIDS: ${
      result.processingUids.length
        ? result.processingUids.join(",")
        : "NONE"
    }`,
  );

  console.log(
    `REPORT: ${result.reportId ?? "NONE"}`,
  );

  console.log(
    `CURSOR: ${
      result.cursorBoundaryBefore ??
      "-"
    } -> ${
      result.cursorBoundaryAfter ??
      "-"
    }`,
  );

  if (
    result.error
  ) {
    console.log(
      `ERROR: ${result.error}`,
    );
  }

  process.exitCode =
    result.exitCode;
}

if (
  require.main === module
) {
  main();
}

module.exports = {
  EXIT_CODES,
  PRODUCTION_CONFIG,
  isProcessAlive,
  readLockOwner,
  acquireSingleInstanceLock,
  releaseSingleInstanceLock,
  classifyCycleResult,
  buildLauncherRecord,
  persistLauncherRecord,
  runProductionLauncher,
};
