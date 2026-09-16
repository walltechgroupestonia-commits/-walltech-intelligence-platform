const fs = require("node:fs");
const path = require("node:path");

const {
  expectedLeadId,
  expectedEvidenceId,
  validateLeadEvidence
} = require("./validate-lead-evidence");

const QUESTION_IDS = Object.freeze({
  company:
    "869ed0fa-d827-4557-b9fb-15d1b43582d6",

  fullName:
    "e078f41d-425f-4c52-9c54-04b7cc21bf9b",

  role:
    "9587e5b4-d42c-4b8f-a74e-3d42f6343fc4",

  email:
    "325f0029-7074-4fe2-87c7-474be79fb305",

  street:
    "39f29ead-b066-4500-9ddf-c1070df7e599",

  postalCode:
    "3c8fee67-a45c-4b78-89b6-e2a0bc14ed8b",

  city:
    "eb9afd4d-ea6a-4ec0-8fdb-3b005afbe8b4",

  province:
    "30a313ae-481b-46c0-b702-e86408ff8aed",

  /*
   * Current routing-form phone workaround.
   * Calendly exposes this question as "Name",
   * therefore identity MUST be UUID-based.
   */
  phoneCurrent:
    "2b7fdae7-d85d-48a9-825f-2c9e68e6d640",

  /*
   * Historical phone field used by earlier
   * Walltech acceptance submissions.
   */
  phoneLegacy:
    "32653146-1e17-4b70-9f93-5d71e83e3072"
});

function extractUuid(value) {
  const text = String(value || "");

  const match = text.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i
  );

  return match
    ? match[1].toLowerCase()
    : null;
}

function trimOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  return text.length
    ? text
    : null;
}

function answerIndex(submission) {
  const index = new Map();

  for (
    const item
    of submission.questions_and_answers || []
  ) {
    if (!item?.question_uuid) continue;

    index.set(
      String(item.question_uuid).toLowerCase(),
      item.answer ?? ""
    );
  }

  return index;
}

function answer(index, ...ids) {
  for (const id of ids) {
    if (index.has(id.toLowerCase())) {
      return trimOrNull(
        index.get(id.toLowerCase())
      );
    }
  }

  return null;
}

function routingResult(submission) {
  const actual =
    submission?.result?.actual_instance;

  if (!actual) {
    return {
      type: "UNKNOWN",
      targetRef: null
    };
  }

  const rawType =
    String(actual.type || "")
      .trim()
      .toLowerCase();

  const types = {
    event_type: "EVENT_TYPE",
    external_url: "EXTERNAL_URL",
    custom_message: "CUSTOM_MESSAGE"
  };

  const type =
    types[rawType] || "UNKNOWN";

  const rawValue =
    trimOrNull(actual.value);

  return {
    type,
    targetRef:
      type === "EVENT_TYPE"
        ? extractUuid(rawValue)
        : rawValue
  };
}

function bookingEvidence(submission) {
  const submitter =
    trimOrNull(submission.submitter);

  const eventMatch =
    submitter &&
    submitter.match(
      /\/scheduled_events\/([0-9a-f-]+)\/invitees\/([0-9a-f-]+)/i
    );

  const scheduledEventId =
    eventMatch
      ? extractUuid(eventMatch[1])
      : null;

  const inviteeId =
    eventMatch
      ? extractUuid(eventMatch[2])
      : null;

  const linked =
    Boolean(
      scheduledEventId &&
      inviteeId
    );

  return {
    linked,

    submitterType:
      trimOrNull(
        submission.submitter_type
      ),

    scheduledEventId,

    inviteeId
  };
}

function normalizeRawAnswers(submission) {
  return (
    submission.questions_and_answers || []
  ).map(item => ({
    questionUuid:
      String(
        item.question_uuid || ""
      ).toLowerCase(),

    question:
      String(item.question || ""),

    answer:
      String(item.answer ?? "")
  }));
}

function adaptCalendlyRoutingSubmission(
  submission,
  options = {}
) {
  if (!submission || typeof submission !== "object") {
    throw new Error(
      "CALENDLY SUBMISSION REQUIRED"
    );
  }

  const routingFormId =
    extractUuid(submission.routing_form);

  const submissionId =
    extractUuid(submission.uri);

  if (!routingFormId) {
    throw new Error(
      "CALENDLY ROUTING FORM ID MISSING"
    );
  }

  if (!submissionId) {
    throw new Error(
      "CALENDLY SUBMISSION ID MISSING"
    );
  }

  const index =
    answerIndex(submission);

  const source = {
    sourceType: "CALENDLY",
    provider: "CALENDLY",
    artifactType:
      "ROUTING_FORM_SUBMISSION",

    routingFormId,
    submissionId,

    createdAt:
      submission.created_at,

    updatedAt:
      submission.updated_at
  };

  const tracking =
    submission.tracking || {};

  const evidence = {
    evidenceVersion: "1.0",
    evidenceType: "LEAD_EVIDENCE",

    leadId:
      expectedLeadId(source),

    evidenceId:
      expectedEvidenceId(source),

    source,

    campaign: {
      utmSource:
        trimOrNull(
          tracking.utm_source
        ),

      utmMedium:
        trimOrNull(
          tracking.utm_medium
        ),

      utmCampaign:
        trimOrNull(
          tracking.utm_campaign
        ),

      utmContent:
        trimOrNull(
          tracking.utm_content
        ),

      utmTerm:
        trimOrNull(
          tracking.utm_term
        ),

      salesforceUuid:
        trimOrNull(
          tracking.salesforce_uuid
        )
    },

    company: {
      legalName:
        answer(
          index,
          QUESTION_IDS.company
        ),

      address: {
        street:
          answer(
            index,
            QUESTION_IDS.street
          ),

        postalCode:
          answer(
            index,
            QUESTION_IDS.postalCode
          ),

        city:
          answer(
            index,
            QUESTION_IDS.city
          ),

        province:
          answer(
            index,
            QUESTION_IDS.province
          )
      }
    },

    contact: {
      fullName:
        answer(
          index,
          QUESTION_IDS.fullName
        ),

      role:
        answer(
          index,
          QUESTION_IDS.role
        ),

      email:
        answer(
          index,
          QUESTION_IDS.email
        ),

      phone:
        answer(
          index,
          QUESTION_IDS.phoneCurrent,
          QUESTION_IDS.phoneLegacy
        )
    },

    routingResult:
      routingResult(submission),

    bookingEvidence:
      bookingEvidence(submission),

    rawAnswers:
      normalizeRawAnswers(submission),

    capturedAt:
      options.capturedAt ||
      new Date().toISOString()
  };

  const validation =
    validateLeadEvidence(evidence);

  if (!validation.valid) {
    const error =
      new Error(
        "CALENDLY → LEADEVIDENCE VALIDATION FAILED"
      );

    error.validation =
      validation.errors;

    throw error;
  }

  return evidence;
}

function main() {
  const inputPath =
    process.argv[2];

  if (!inputPath) {
    console.error(
      "Usage: node src/leads/adapt-calendly-routing-submission.js <submission.json>"
    );

    process.exit(2);
  }

  const submission =
    JSON.parse(
      fs.readFileSync(
        path.resolve(
          process.cwd(),
          inputPath
        ),
        "utf8"
      )
    );

  try {
    const evidence =
      adaptCalendlyRoutingSubmission(
        submission
      );

    process.stdout.write(
      JSON.stringify(
        evidence,
        null,
        2
      ) + "\n"
    );
  } catch (error) {
    console.error(
      error.message || String(error)
    );

    if (error.validation) {
      console.error(
        JSON.stringify(
          error.validation,
          null,
          2
        )
      );
    }

    process.exit(1);
  }
}

module.exports = {
  QUESTION_IDS,
  extractUuid,
  adaptCalendlyRoutingSubmission
};

if (require.main === module) {
  main();
}
