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

const DEFAULT_REGISTRY =
  "src/mail/mail-account-registry.json";

const DEFAULT_SCHEMA =
  "src/mail/mail-account-registry.schema.json";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function loadJson(filePath, label) {
  const absolute =
    path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolute)) {
    fail(`${label} NOT FOUND: ${filePath}`, 2);
  }

  try {
    return JSON.parse(
      fs.readFileSync(absolute, "utf8")
    );
  } catch (error) {
    fail(
      `${label} INVALID JSON: ${error.message}`,
      2
    );
  }
}

const registryPath =
  process.argv[2] ||
  DEFAULT_REGISTRY;

const schemaPath =
  process.argv[3] ||
  DEFAULT_SCHEMA;

const registry =
  loadJson(registryPath, "REGISTRY");

const schema =
  loadJson(schemaPath, "SCHEMA");

const ajv =
  new Ajv2020({
    allErrors: true,
    strict: true,
  });

addFormats(ajv);

let validate;

try {
  validate = ajv.compile(schema);
} catch (error) {
  fail(
    `SCHEMA COMPILE ERROR: ${error.message}`,
    3
  );
}

if (!validate(registry)) {
  console.error(
    "MAIL ACCOUNT REGISTRY: INVALID"
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

const accountKeys =
  new Set();

const mailboxUsers =
  new Set();

for (const account of registry.accounts) {
  if (accountKeys.has(account.accountKey)) {
    fail(
      `DUPLICATE ACCOUNT KEY: ${account.accountKey}`,
      4
    );
  }

  accountKeys.add(account.accountKey);

  const normalizedUser =
    account.mailboxUser.toLowerCase();

  if (mailboxUsers.has(normalizedUser)) {
    fail(
      `DUPLICATE MAILBOX USER: ${account.mailboxUser}`,
      4
    );
  }

  mailboxUsers.add(normalizedUser);

  if (
    !account.routingAddresses
      .map((value) => value.toLowerCase())
      .includes(normalizedUser)
  ) {
    fail(
      `PRIMARY MAILBOX USER MISSING FROM ROUTING ADDRESSES: ${account.accountKey}`,
      4
    );
  }
}

console.log(
  "MAIL ACCOUNT REGISTRY: VALID"
);

console.log(
  `ACCOUNTS: ${registry.accounts.length}`
);

for (const account of registry.accounts) {
  console.log(
    `${account.accountKey} | ` +
    `${account.mailboxUser} | ` +
    `${account.provider} | ` +
    `${account.activationStatus}`
  );
}
