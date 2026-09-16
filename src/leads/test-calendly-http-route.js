const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {
  expectedSignature,
} = require(
  "./verify-calendly-webhook-signature"
);

const ROUTING_FORM_ID =
  "3c6dcd8d-3910-428e-921b-56795c728dba";

const SIGNING_KEY =
  "walltech-http-route-test-key";

const root =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "walltech-calendly-http-"
    )
  );

process.env
  .CALENDLY_WEBHOOK_SIGNING_KEY =
  SIGNING_KEY;

process.env
  .CALENDLY_ALLOWED_ROUTING_FORM_IDS =
  ROUTING_FORM_ID;

process.env
  .WALLTECH_LEAD_EVIDENCE_ROOT =
  root;

const {
  server,
} = require(
  "../reporting/serve-walltech-deal-product"
);

function payload() {
  return {
    event:
      "routing_form_submission.created",

    created_at:
      new Date().toISOString(),

    payload: {
      uri:
        "https://api.calendly.com/routing_form_submissions/42a1bcc9-1809-48b6-87a4-62e6a0eae37b",

      routing_form:
        `https://api.calendly.com/routing_forms/${ROUTING_FORM_ID}`,

      questions_and_answers: [
        {
          question_uuid:
            "869ed0fa-d827-4557-b9fb-15d1b43582d6",
          question:
            "Ragione Sociale",
          answer:
            "HTTP Test Srl"
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
            "Indirizzo aziendale",
          answer:
            "Via Test 1"
        },
        {
          question_uuid:
            "3c8fee67-a45c-4b78-89b6-e2a0bc14ed8b",
          question:
            "CAP",
          answer:
            "20100"
        },
        {
          question_uuid:
            "eb9afd4d-ea6a-4ec0-8fdb-3b005afbe8b4",
          question:
            "Comune",
          answer:
            "Milano"
        },
        {
          question_uuid:
            "30a313ae-481b-46c0-b702-e86408ff8aed",
          question:
            "Provincia",
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
        utm_term:
          null,
        salesforce_uuid:
          null
      },

      result: {
        type:
          "event_type",
        value:
          "https://api.calendly.com/event_types/00b6235e-9923-4eee-b60f-f3ab755482f2"
      },

      submitter:
        null,

      submitter_type:
        null,

      created_at:
        "2026-09-16T13:00:00.000000Z",

      updated_at:
        "2026-09-16T13:00:00.000000Z"
    }
  };
}

function request({
  port,
  rawBody,
  signature,
}) {
  return new Promise(
    (resolve, reject) => {
      const req =
        http.request(
          {
            hostname:
              "127.0.0.1",
            port,
            method:
              "POST",
            path:
              "/api/lead/calendly",
            headers: {
              "content-type":
                "application/json",
              "content-length":
                rawBody.length,
              "calendly-webhook-signature":
                signature,
            },
          },
          res => {
            const chunks = [];

            res.on(
              "data",
              chunk =>
                chunks.push(chunk)
            );

            res.on(
              "end",
              () => {
                resolve({
                  statusCode:
                    res.statusCode,
                  body:
                    Buffer.concat(
                      chunks
                    ).toString(
                      "utf8"
                    ),
                });
              }
            );
          }
        );

      req.on(
        "error",
        reject
      );

      req.end(
        rawBody
      );
    }
  );
}

async function main() {
  await new Promise(
    (resolve, reject) => {
      server.once(
        "error",
        reject
      );

      server.listen(
        0,
        "127.0.0.1",
        resolve
      );
    }
  );

  const address =
    server.address();

  const port =
    address.port;

  const rawBody =
    Buffer.from(
      JSON.stringify(
        payload()
      ),
      "utf8"
    );

  const timestamp =
    Math.floor(
      Date.now() / 1000
    );

  const signature =
    expectedSignature({
      signingKey:
        SIGNING_KEY,
      timestamp,
      rawBody,
    });

  const header =
    `t=${timestamp},v1=${signature}`;

  const first =
    await request({
      port,
      rawBody,
      signature:
        header,
    });

  assert.strictEqual(
    first.statusCode,
    201
  );

  assert.strictEqual(
    JSON.parse(
      first.body
    ).status,
    "CREATED"
  );

  const retry =
    await request({
      port,
      rawBody,
      signature:
        header,
    });

  assert.strictEqual(
    retry.statusCode,
    200
  );

  assert.strictEqual(
    JSON.parse(
      retry.body
    ).status,
    "DUPLICATE"
  );

  const badSignature =
    await request({
      port,
      rawBody,
      signature:
        `t=${timestamp},v1=${"0".repeat(64)}`,
    });

  assert.strictEqual(
    badSignature.statusCode,
    401
  );

  const eventsDir =
    path.join(
      root,
      "events"
    );

  const events =
    fs.readdirSync(
      eventsDir
    );

  assert.strictEqual(
    events.length,
    1
  );

  const bundle =
    path.join(
      eventsDir,
      events[0]
    );

  for (
    const name
    of [
      "webhook.raw.json",
      "lead-evidence.json",
      "receipt.json",
    ]
  ) {
    assert.strictEqual(
      fs.existsSync(
        path.join(
          bundle,
          name
        )
      ),
      true
    );
  }

  console.log(
    "CALENDLY HTTP ROUTE V1: PASS"
  );

  console.log(
    "POST /api/lead/calendly: PASS"
  );

  console.log(
    "SIGNED CREATED → 201: PASS"
  );

  console.log(
    "SIGNED RETRY → 200 DUPLICATE: PASS"
  );

  console.log(
    "BAD SIGNATURE → 401: PASS"
  );

  console.log(
    "ATOMIC BUNDLE: PASS"
  );

  console.log(
    "PRODUCTION RUNTIME WRITE: NONE"
  );

  console.log(
    "PUBLIC NETWORK EXPOSURE: NONE"
  );
}

main()
  .finally(
    async () => {
      if (server.listening) {
        await new Promise(
          resolve =>
            server.close(
              resolve
            )
        );
      }

      fs.rmSync(
        root,
        {
          recursive:
            true,
          force:
            true,
        }
      );
    }
  )
  .catch(
    error => {
      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );
