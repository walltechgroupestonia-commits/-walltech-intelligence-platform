const assert = require("node:assert");

const {
  expectedLeadId,
  expectedEvidenceId,
  validateLeadEvidence
} = require("./validate-lead-evidence");

function build(updatedAt) {
  const source = {
    sourceType: "CALENDLY",
    provider: "CALENDLY",
    artifactType: "ROUTING_FORM_SUBMISSION",
    routingFormId:
      "3c6dcd8d-3910-428e-921b-56795c728dba",
    submissionId:
      "42a1bcc9-1809-48b6-87a4-62e6a0eae37b",
    createdAt:
      "2026-09-15T20:30:09.389854Z",
    updatedAt
  };

  return {
    evidenceVersion: "1.0",
    evidenceType: "LEAD_EVIDENCE",

    leadId:
      expectedLeadId(source),

    evidenceId:
      expectedEvidenceId(source),

    source,

    campaign: {
      utmSource: "facebook",
      utmMedium: "organic_social",
      utmCampaign: "confronto_impresa_2026",
      utmContent: "crediti_fiscali_static_01",
      utmTerm: null,
      salesforceUuid: null
    },

    company: {
      legalName: "Example Impresa Srl",
      address: {
        street: "Via Esempio 1",
        postalCode: "20100",
        city: "Milano",
        province: "MI"
      }
    },

    contact: {
      fullName: "Mario Rossi",
      role: "CEO",
      email: "mario.rossi@example.com",
      phone: "0373 123456"
    },

    routingResult: {
      type: "EVENT_TYPE",
      targetRef:
        "00b6235e-9923-4eee-b60f-f3ab755482f2"
    },

    bookingEvidence: {
      linked: false,
      submitterType: null,
      scheduledEventId: null,
      inviteeId: null
    },

    rawAnswers: [
      {
        questionUuid:
          "869ed0fa-d827-4557-b9fb-15d1b43582d6",
        question: "Ragione Sociale",
        answer: "Example Impresa Srl"
      },
      {
        questionUuid:
          "e078f41d-425f-4c52-9c54-04b7cc21bf9b",
        question: "Name",
        answer: "Mario Rossi"
      },
      {
        questionUuid:
          "2b7fdae7-d85d-48a9-825f-2c9e68e6d640",
        question: "Name",
        answer: "0373 123456"
      }
    ],

    capturedAt:
      "2026-09-16T13:30:00.000Z"
  };
}

const first =
  build("2026-09-15T20:30:09.389854Z");

const firstAgain =
  build("2026-09-15T20:30:09.389854Z");

const laterSnapshot =
  build("2026-09-15T20:35:09.389854Z");

assert.strictEqual(
  validateLeadEvidence(first).valid,
  true
);

assert.strictEqual(
  first.leadId,
  firstAgain.leadId
);

assert.strictEqual(
  first.evidenceId,
  firstAgain.evidenceId
);

assert.strictEqual(
  first.leadId,
  laterSnapshot.leadId
);

assert.notStrictEqual(
  first.evidenceId,
  laterSnapshot.evidenceId
);

const tampered = JSON.parse(
  JSON.stringify(first)
);

tampered.leadId =
  "LEAD-" + "0".repeat(64);

assert.strictEqual(
  validateLeadEvidence(tampered).valid,
  false
);

const invalid = JSON.parse(
  JSON.stringify(first)
);

delete invalid.campaign.utmCampaign;

assert.strictEqual(
  validateLeadEvidence(invalid).valid,
  false
);

console.log(
  "LEAD EVIDENCE CONTRACT V1: PASS"
);

console.log(
  "STABLE LEAD ID: PASS"
);

console.log(
  "IMMUTABLE SNAPSHOT ID: PASS"
);

console.log(
  "TAMPERED ID REJECTED: PASS"
);

console.log(
  "INVALID CONTRACT REJECTED: PASS"
);

console.log(
  "HUBSPOT WRITE: NONE"
);

console.log(
  "COCKPIT RUNTIME MUTATION: NONE"
);
