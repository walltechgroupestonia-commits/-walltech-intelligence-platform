const fs = require("node:fs");
const path = require("node:path");

const Ajv2020 =
  require("ajv/dist/2020").default;

const addFormats =
  require("ajv-formats");

const schema =
  require(
    "./mailbox-processing-cursor.schema.json"
  );

function nonBlank(
  value,
) {
  return (
    typeof value === "string" &&
    value.trim() !== ""
  );
}

function validateMailboxProcessingCursor(
  cursor,
) {
  const ajv =
    new Ajv2020({
      allErrors: true,
      strict: true,
    });

  addFormats(ajv);

  const validate =
    ajv.compile(
      schema,
    );

  const valid =
    validate(
      cursor,
    );

  if (!valid) {
    return {
      valid: false,
      errors:
        validate.errors ?? [],
    };
  }

  const semanticErrors = [];

  if (
    !nonBlank(
      cursor.accountLookup,
    )
  ) {
    semanticErrors.push(
      "ACCOUNT LOOKUP MUST BE NON-BLANK",
    );
  }

  if (
    !nonBlank(
      cursor.mailboxPath,
    )
  ) {
    semanticErrors.push(
      "MAILBOX PATH MUST BE NON-BLANK",
    );
  }

  /*
   * UIDNEXT must be greater than every UID
   * already assigned in this UIDVALIDITY epoch.
   *
   * Therefore the committed boundary must always
   * remain strictly below the observed UIDNEXT.
   */
  if (
    cursor.boundaryUid >=
    cursor.lastObservedUidNext
  ) {
    semanticErrors.push(
      "BOUNDARY UID MUST BE LOWER THAN LAST OBSERVED UIDNEXT",
    );
  }

  const establishedAt =
    Date.parse(
      cursor.establishedAt,
    );

  const updatedAt =
    Date.parse(
      cursor.updatedAt,
    );

  if (
    Number.isFinite(establishedAt) &&
    Number.isFinite(updatedAt) &&
    updatedAt < establishedAt
  ) {
    semanticErrors.push(
      "UPDATED AT CANNOT PRECEDE ESTABLISHED AT",
    );
  }

  return {
    valid:
      semanticErrors.length === 0,

    errors:
      semanticErrors,
  };
}

function main() {
  const inputPath =
    process.argv[2];

  if (!inputPath) {
    console.error(
      "Usage: node src/mail/validate-mailbox-processing-cursor.js <cursor.json>",
    );

    process.exitCode = 2;
    return;
  }

  try {
    const absolutePath =
      path.resolve(
        process.cwd(),
        inputPath,
      );

    const cursor =
      JSON.parse(
        fs.readFileSync(
          absolutePath,
          "utf8",
        ),
      );

    const result =
      validateMailboxProcessingCursor(
        cursor,
      );

    if (!result.valid) {
      console.error(
        "MAILBOX PROCESSING CURSOR: INVALID",
      );

      for (
        const error
        of result.errors
      ) {
        if (
          typeof error === "string"
        ) {
          console.error(
            `- ${error}`,
          );
        } else {
          console.error(
            `- ${error.instancePath || "/"} ${error.message}`,
          );
        }
      }

      process.exitCode = 1;
      return;
    }

    console.log(
      "MAILBOX PROCESSING CURSOR: VALID",
    );

    console.log(
      `ACCOUNT: ${cursor.accountLookup}`,
    );

    console.log(
      `MAILBOX: ${cursor.mailboxPath}`,
    );

    console.log(
      `UIDVALIDITY: ${cursor.uidValidity}`,
    );

    console.log(
      `BOUNDARY UID: ${cursor.boundaryUid}`,
    );

    console.log(
      `BOUNDARY KIND: ${cursor.boundaryKind}`,
    );

    console.log(
      `OBSERVED UIDNEXT: ${cursor.lastObservedUidNext}`,
    );

    console.log(
      "CURSOR MUTATION: NONE",
    );
  } catch (error) {
    console.error(
      "MAILBOX PROCESSING CURSOR: INVALID",
    );

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
  validateMailboxProcessingCursor,
};
