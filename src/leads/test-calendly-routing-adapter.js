const assert = require("node:assert");

const {
  QUESTION_IDS,
  adaptCalendlyRoutingSubmission
} = require(
  "./adapt-calendly-routing-submission"
);

function qa(
  question_uuid,
  question,
  answer
) {
  return {
    question_uuid,
    question,
    answer
  };
}

function baseSubmission() {
  return {
    uri:
      "https://api.calendly.com/routing_form_submissions/42a1bcc9-1809-48b6-87a4-62e6a0eae37b",

    routing_form:
      "https://api.calendly.com/routing_forms/3c6dcd8d-3910-428e-921b-56795c728dba",

    questions_and_answers: [
      qa(
        QUESTION_IDS.company,
        "Ragione Sociale",
        "Example Impresa Srl"
      ),

      qa(
        QUESTION_IDS.fullName,
        "Name",
        "Mario Rossi"
      ),

      qa(
        QUESTION_IDS.role,
        "Ruolo in Azienda",
        "CEO"
      ),

      qa(
        QUESTION_IDS.email,
        "Email",
        "mario.rossi@example.com"
      ),

      qa(
        QUESTION_IDS.street,
        "Indirizzo aziendale — Via/Piazza e Numero civico",
        "Via Esempio 1"
      ),

      qa(
        QUESTION_IDS.postalCode,
        "CAP sede aziendale",
        "20100"
      ),

      qa(
        QUESTION_IDS.city,
        "Comune sede aziendale",
        "Milano"
      ),

      qa(
        QUESTION_IDS.province,
        "Provincia sede aziendale — sigla",
        "MI"
      ),

      qa(
        QUESTION_IDS.phoneCurrent,
        "Name",
        "0373 123456"
      )
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
      actual_instance: {
        type: "event_type",
        value:
          "https://api.calendly.com/event_types/00b6235e-9923-4eee-b60f-f3ab755482f2"
      }
    },

    submitter: null,
    submitter_type: null,

    created_at:
      "2026-09-16T13:00:00.000000Z",

    updated_at:
      "2026-09-16T13:00:00.000000Z"
  };
}

const current =
  baseSubmission();

const first =
  adaptCalendlyRoutingSubmission(
    current,
    {
      capturedAt:
        "2026-09-16T13:10:00.000Z"
    }
  );

assert.strictEqual(
  first.company.legalName,
  "Example Impresa Srl"
);

assert.strictEqual(
  first.contact.fullName,
  "Mario Rossi"
);

assert.strictEqual(
  first.contact.phone,
  "0373 123456"
);

assert.strictEqual(
  first.campaign.utmSource,
  "facebook"
);

assert.strictEqual(
  first.campaign.utmMedium,
  "organic_social"
);

assert.strictEqual(
  first.campaign.utmCampaign,
  "confronto_impresa_2026"
);

assert.strictEqual(
  first.campaign.utmContent,
  "crediti_fiscali_static_01"
);

assert.strictEqual(
  first.routingResult.type,
  "EVENT_TYPE"
);

assert.strictEqual(
  first.routingResult.targetRef,
  "00b6235e-9923-4eee-b60f-f3ab755482f2"
);

assert.strictEqual(
  first.bookingEvidence.linked,
  false
);

/*
 * Same Calendly submission later becomes
 * linked to a real booked invitee.
 */
const booked =
  baseSubmission();

booked.updated_at =
  "2026-09-16T13:05:00.000000Z";

booked.submitter =
  "https://api.calendly.com/scheduled_events/05533ae5-b938-45d7-81a3-68ce515735d3/invitees/049f5f63-9d33-4d86-896e-cf8a9a543228";

booked.submitter_type =
  "Invitee";

const later =
  adaptCalendlyRoutingSubmission(
    booked,
    {
      capturedAt:
        "2026-09-16T13:06:00.000Z"
    }
  );

assert.strictEqual(
  later.bookingEvidence.linked,
  true
);

assert.strictEqual(
  later.bookingEvidence.scheduledEventId,
  "05533ae5-b938-45d7-81a3-68ce515735d3"
);

assert.strictEqual(
  later.bookingEvidence.inviteeId,
  "049f5f63-9d33-4d86-896e-cf8a9a543228"
);

/*
 * Lead identity survives later snapshot.
 */
assert.strictEqual(
  first.leadId,
  later.leadId
);

/*
 * Evidence identity changes when Calendly
 * updated_at changes.
 */
assert.notStrictEqual(
  first.evidenceId,
  later.evidenceId
);

/*
 * Historical phone UUID remains supported.
 */
const legacyPhone =
  baseSubmission();

legacyPhone.questions_and_answers =
  legacyPhone.questions_and_answers
    .filter(
      item =>
        item.question_uuid !==
        QUESTION_IDS.phoneCurrent
    );

legacyPhone.questions_and_answers.push(
  qa(
    QUESTION_IDS.phoneLegacy,
    "Numero di Cellulare",
    "+39 350 108 9693"
  )
);

const legacy =
  adaptCalendlyRoutingSubmission(
    legacyPhone,
    {
      capturedAt:
        "2026-09-16T13:10:00.000Z"
    }
  );

assert.strictEqual(
  legacy.contact.phone,
  "+39 350 108 9693"
);

/*
 * Missing mandatory business identity
 * must fail closed.
 */
const invalid =
  baseSubmission();

invalid.questions_and_answers =
  invalid.questions_and_answers.filter(
    item =>
      item.question_uuid !==
      QUESTION_IDS.email
  );

assert.throws(
  () =>
    adaptCalendlyRoutingSubmission(
      invalid,
      {
        capturedAt:
          "2026-09-16T13:10:00.000Z"
      }
    ),
  /VALIDATION FAILED/
);

console.log(
  "CALENDLY ROUTING ADAPTER V1: PASS"
);

console.log(
  "CURRENT PHONE UUID: PASS"
);

console.log(
  "LEGACY PHONE UUID: PASS"
);

console.log(
  "UTM ATTRIBUTION: PASS"
);

console.log(
  "BOOKING LINKAGE: PASS"
);

console.log(
  "LEAD ID CONTINUITY: PASS"
);

console.log(
  "SNAPSHOT VERSIONING: PASS"
);

console.log(
  "FAIL-CLOSED REQUIRED DATA: PASS"
);

console.log(
  "HUBSPOT WRITE: NONE"
);

console.log(
  "DEAL CREATION: NONE"
);

console.log(
  "COCKPIT RUNTIME MUTATION: NONE"
);
