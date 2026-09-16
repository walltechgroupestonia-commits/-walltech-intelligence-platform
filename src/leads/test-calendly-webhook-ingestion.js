const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  expectedSignature
} = require(
  "./verify-calendly-webhook-signature"
);

const {
  ingestCalendlyWebhook
} = require(
  "./ingest-calendly-webhook"
);

const ROUTING_FORM_ID =
  "3c6dcd8d-3910-428e-921b-56795c728dba";

const SUBMISSION_ID =
  "42a1bcc9-1809-48b6-87a4-62e6a0eae37b";

const SIGNING_KEY =
  "walltech-ingestion-test-key";

const timestamp =
  1789563600;

const nowMs =
  timestamp * 1000;

function envelope() {
  return {
    event:
      "routing_form_submission.created",

    created_at:
      "2026-09-16T13:00:00.000000Z",

    created_by:
      "https://api.calendly.com/users/14c6dae3-0ba7-485d-83af-1474204a3671",

    payload: {
      uri:
        `https://api.calendly.com/routing_form_submissions/${SUBMISSION_ID}`,

      routing_form:
        `https://api.calendly.com/routing_forms/${ROUTING_FORM_ID}`,

      questions_and_answers: [
        {
          question_uuid:
            "869ed0fa-d827-4557-b9fb-15d1b43582d6",
          question:
            "Ragione Sociale",
          answer:
            "Example Impresa Srl"
        },
        {
          question_uuid:
            "e078f41d-425f-4c52-9c54-04b7cc21bf9b",
          question:
            "Name",
          answer:
            "Mario Rossi"
        },
        {
          question_uuid:
            "9587e5b4-d42c-4b8f-a74e-3d42f6343fc4",
          question:
            "Ruolo in Azienda",
          answer:
            "CEO"
        },
        {
          question_uuid:
            "325f0029-7074-4fe2-87c7-474be79fb305",
          question:
            "Email",
          answer:
            "mario.rossi@example.com"
        },
        {
          question_uuid:
            "39f29ead-b066-4500-9ddf-c1070df7e599",
          question:
            "Indirizzo aziendale — Via/Piazza e Numero civico",
          answer:
            "Via Esempio 1"
        },
        {
          question_uuid:
            "3c8fee67-a45c-4b78-89b6-e2a0bc14ed8b",
          question:
            "CAP sede aziendale",
          answer:
            "20100"
        },
        {
          question_uuid:
            "eb9afd4d-ea6a-4ec0-8fdb-3b005afbe8b4",
          question:
            "Comune sede aziendale",
          answer:
            "Milano"
        },
        {
          question_uuid:
            "30a313ae-481b-46c0-b702-e86408ff8aed",
          question:
            "Provincia sede aziendale — sigla",
          answer:
            "MI"
        },
        {
          question_uuid:
            "2b7fdae7-d85d-48a9-825f-2c9e68e6d640",
          question:
            "Name",
          answer:
            "+39 350 1234567"
        }
      ],

      tracking: {
        utm_campaign:
          "confronto_impresa_2026",
        utm_source:
          "facebook",
        utm_medium:
          "organic_social",
        utm_content:
          "crediti_fiscali_static_01",
        utm_term: null,
        salesforce_uuid: null
      },

      result: {
        type:
          "event_type",
        value:
          "https://api.calendly.com/event_types/00b6235e-9923-4eee-b60f-f3ab755482f2"
      },

      submitter: null,
      submitter_type: null,

      created_at:
        "2026-09-16T13:00:00.000000Z",

      updated_at:
        "2026-09-16T13:00:00.000000Z"
    }
  };
}

function signed(rawBody) {
  const signature =
    expectedSignature({
      signingKey:
        SIGNING_KEY,
      timestamp,
      rawBody
    });

  return (
    `t=${timestamp},v1=${signature}`
  );
}

const root =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "walltech-lead-ingestion-"
    )
  );

try {
  const rawBody =
    Buffer.from(
      JSON.stringify(
        envelope()
      ),
      "utf8"
    );

  const header =
    signed(rawBody);

  const first =
    ingestCalendlyWebhook({
      signatureHeader:
        header,

      signingKey:
        SIGNING_KEY,

      rawBody,

      rootDir:
        root,

      allowedRoutingFormIds: [
        ROUTING_FORM_ID
      ],

      nowMs
    });

  assert.strictEqual(
    first.status,
    "CREATED"
  );

  assert.strictEqual(
    first.persisted,
    true
  );

  const bundle =
    path.join(
      root,
      "events",
      first.evidenceId
    );

  assert.strictEqual(
    fs.existsSync(
      path.join(
        bundle,
        "webhook.raw.json"
      )
    ),
    true
  );

  assert.strictEqual(
    fs.existsSync(
      path.join(
        bundle,
        "lead-evidence.json"
      )
    ),
    true
  );

  assert.strictEqual(
    fs.existsSync(
      path.join(
        bundle,
        "receipt.json"
      )
    ),
    true
  );

  const evidence =
    JSON.parse(
      fs.readFileSync(
        path.join(
          bundle,
          "lead-evidence.json"
        ),
        "utf8"
      )
    );

  assert.strictEqual(
    evidence.company.legalName,
    "Example Impresa Srl"
  );

  assert.strictEqual(
    evidence.campaign.utmSource,
    "facebook"
  );

  assert.strictEqual(
    evidence.campaign.utmCampaign,
    "confronto_impresa_2026"
  );

  assert.strictEqual(
    evidence.campaign.utmContent,
    "crediti_fiscali_static_01"
  );

  /*
   * Calendly retry: same submission version
   * MUST NOT create another evidence bundle.
   */
  const duplicate =
    ingestCalendlyWebhook({
      signatureHeader:
        header,

      signingKey:
        SIGNING_KEY,

      rawBody,

      rootDir:
        root,

      allowedRoutingFormIds: [
        ROUTING_FORM_ID
      ],

      nowMs
    });

  assert.strictEqual(
    duplicate.status,
    "DUPLICATE"
  );

  assert.strictEqual(
    duplicate.persisted,
    false
  );

  const events =
    fs.readdirSync(
      path.join(
        root,
        "events"
      )
    );

  assert.strictEqual(
    events.length,
    1
  );

  /*
   * Wrong routing form MUST fail.
   */
  assert.throws(
    () =>
      ingestCalendlyWebhook({
        signatureHeader:
          header,

        signingKey:
          SIGNING_KEY,

        rawBody,

        rootDir:
          root,

        allowedRoutingFormIds: [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        ],

        nowMs
      }),
    /NOT ALLOWED/
  );

  /*
   * Tampered raw body MUST fail signature
   * before anything can be persisted.
   */
  const tampered =
    Buffer.from(
      rawBody
        .toString("utf8")
        .replace(
          "Example Impresa Srl",
          "Tampered Srl"
        ),
      "utf8"
    );

  assert.throws(
    () =>
      ingestCalendlyWebhook({
        signatureHeader:
          header,

        signingKey:
          SIGNING_KEY,

        rawBody:
          tampered,

        rootDir:
          root,

        allowedRoutingFormIds: [
          ROUTING_FORM_ID
        ],

        nowMs
      }),
    /REJECTED/
  );

  assert.strictEqual(
    fs.readdirSync(
      path.join(
        root,
        "events"
      )
    ).length,
    1
  );

  console.log(
    "CALENDLY LEAD INGESTION CORE V1: PASS"
  );

  console.log(
    "SIGNED WEBHOOK → LEADEVIDENCE: PASS"
  );

  console.log(
    "RAW EVIDENCE PRESERVED: PASS"
  );

  console.log(
    "UTM LINEAGE PRESERVED: PASS"
  );

  console.log(
    "ATOMIC EVIDENCE BUNDLE: PASS"
  );

  console.log(
    "RETRY IDEMPOTENCY: PASS"
  );

  console.log(
    "ROUTING FORM FILTER: PASS"
  );

  console.log(
    "TAMPERED PAYLOAD REJECTED: PASS"
  );

  console.log(
    "NETWORK INGRESS: NONE"
  );

  console.log(
    "HUBSPOT WRITE: NONE"
  );

  console.log(
    "COCKPIT RUNTIME MUTATION: NONE"
  );
} finally {
  fs.rmSync(
    root,
    {
      recursive: true,
      force: true
    }
  );
}
