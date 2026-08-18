const fs = require("node:fs");
const path = require("node:path");

const REGISTRY_PATH =
  "src/mail/mail-account-registry.json";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function loadRegistry() {
  const absolute =
    path.resolve(
      process.cwd(),
      REGISTRY_PATH
    );

  if (!fs.existsSync(absolute)) {
    fail(
      `MAIL ACCOUNT REGISTRY NOT FOUND: ${REGISTRY_PATH}`,
      2
    );
  }

  return JSON.parse(
    fs.readFileSync(
      absolute,
      "utf8"
    )
  );
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function main() {
  const lookup =
    process.argv[2];

  if (!lookup) {
    console.error(
      "Usage: node src/mail/resolve-mail-account.js <ACCOUNT_KEY|EMAIL>"
    );

    process.exit(2);
  }

  const registry =
    loadRegistry();

  const normalized =
    normalize(lookup);

  const account =
    registry.accounts.find(
      (item) =>
        normalize(item.accountKey) ===
          normalized ||
        normalize(item.mailboxUser) ===
          normalized ||
        item.routingAddresses.some(
          (address) =>
            normalize(address) ===
            normalized
        )
    );

  if (!account) {
    fail(
      `MAIL ACCOUNT NOT FOUND: ${lookup}`,
      4
    );
  }

  process.stdout.write(
    JSON.stringify(
      account,
      null,
      2
    ) + "\n"
  );
}

main();
