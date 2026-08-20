const HUBSPOT_BASE =
  "https://api.hubapi.com";

const PROPERTY_BASE =
  "/crm/properties/2026-03/tickets";

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function token() {
  const value =
    process.env
      .HUBSPOT_PRIVATE_APP_TOKEN;

  invariant(
    value,
    "HUBSPOT_PRIVATE_APP_TOKEN MISSING"
  );

  return value;
}

async function request(
  pathname,
  {
    method = "GET",
    body = null,
    allow404 = false,
  } = {}
) {
  const response =
    await fetch(
      `${HUBSPOT_BASE}${pathname}`,
      {
        method,

        headers: {
          Authorization:
            `Bearer ${token()}`,

          Accept:
            "application/json",

          ...(body
            ? {
                "Content-Type":
                  "application/json",
              }
            : {}),
        },

        ...(body
          ? {
              body:
                JSON.stringify(body),
            }
          : {}),
      }
    );

  if (
    allow404 &&
    response.status === 404
  ) {
    return null;
  }

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `HUBSPOT ${method} ${pathname} HTTP ${response.status}: ${text.slice(0, 500)}`
    );
  }

  return text
    ? JSON.parse(text)
    : {};
}

const definitions = [
  {
    name:
      "walltech_decision_classification",

    label:
      "Walltech Decision Classification",

    description:
      "Decisione esplicita Max sulla MailEvidence.",

    type:
      "enumeration",

    fieldType:
      "select",

    options: [
      "NEW_CYCLE",
      "LINK_EXISTING",
      "NON_DEAL_RELEVANT",
      "IGNORE",
    ].map(
      (value, index) => ({
        label:
          value
            .replaceAll("_", " "),

        value,

        displayOrder:
          index,

        hidden:
          false,
      })
    ),
  },

  {
    name:
      "walltech_cycle_id",

    label:
      "Walltech Cycle ID",

    description:
      "ID autorevole del ciclo Walltech.",

    type:
      "string",

    fieldType:
      "text",
  },

  {
    name:
      "walltech_cycle_name",

    label:
      "Walltech Cycle Name",

    description:
      "Nome operativo del ciclo.",

    type:
      "string",

    fieldType:
      "text",
  },

  {
    name:
      "walltech_assigned_collaborator_ids",

    label:
      "Walltech Assigned Collaborator IDs",

    description:
      "Collaboratori assegnati. Separare più ID con virgola.",

    type:
      "string",

    fieldType:
      "textarea",
  },

  {
    name:
      "walltech_report_recipient_collaborator_ids",

    label:
      "Walltech Report Recipient Collaborator IDs",

    description:
      "Collaboratori autorizzati a ricevere il ciclo nel proprio report.",

    type:
      "string",

    fieldType:
      "textarea",
  },

  {
    name:
      "walltech_cycle_priority",

    label:
      "Walltech Cycle Priority",

    description:
      "Priorità operativa del ciclo.",

    type:
      "enumeration",

    fieldType:
      "select",

    options: [
      "LOW",
      "MEDIUM",
      "HIGH",
      "CRITICAL",
    ].map(
      (value, index) => ({
        label:
          value,

        value,

        displayOrder:
          index,

        hidden:
          false,
      })
    ),
  },

  {
    name:
      "walltech_cycle_next_action",

    label:
      "Walltech Cycle Next Action",

    description:
      "Prossima azione operativa autorizzata da Max.",

    type:
      "string",

    fieldType:
      "textarea",
  },

  {
    name:
      "walltech_cycle_next_action_due_at",

    label:
      "Walltech Cycle Next Action Due At",

    description:
      "Scadenza della prossima azione.",

    type:
      "datetime",

    fieldType:
      "date",
  },
];

async function main() {
  const approval =
    process.argv[2];

  invariant(
    approval ===
      "--max-approved",
    "PROPERTY CREATION REQUIRES --max-approved"
  );

  /*
   * Reuse the same HubSpot property group
   * already used by Walltech decision fields.
   */
  const anchor =
    await request(
      `${PROPERTY_BASE}/walltech_decision_at`
    );

  const groupName =
    anchor.groupName;

  invariant(
    groupName,
    "WALLTECH PROPERTY GROUP NOT RESOLVED"
  );

  console.log(
    "PROPERTY GROUP:",
    groupName
  );

  let created = 0;
  let existing = 0;

  for (
    const definition
    of definitions
  ) {
    const current =
      await request(
        `${PROPERTY_BASE}/${definition.name}`,
        {
          allow404:
            true,
        }
      );

    if (current) {
      console.log(
        `EXISTING: ${definition.name}`
      );

      existing += 1;
      continue;
    }

    await request(
      PROPERTY_BASE,
      {
        method:
          "POST",

        body: {
          groupName,

          name:
            definition.name,

          label:
            definition.label,

          description:
            definition.description,

          type:
            definition.type,

          fieldType:
            definition.fieldType,

          formField:
            false,

          hidden:
            false,

          options:
            definition.options || [],
        },
      }
    );

    console.log(
      `CREATED: ${definition.name}`
    );

    created += 1;
  }

  console.log("");
  console.log(
    "DECISION RETURN PROPERTIES: PASS"
  );

  console.log(
    "CREATED:",
    created
  );

  console.log(
    "EXISTING:",
    existing
  );

  console.log(
    "TICKET RECORD MUTATION: NONE"
  );

  console.log(
    "DEAL MUTATION: NONE"
  );

  console.log(
    "EMAIL SEND: NONE"
  );
}

main().catch(
  error => {
    console.error(
      "PROPERTY PROVISION ERROR:",
      error.message
    );

    process.exit(1);
  }
);
