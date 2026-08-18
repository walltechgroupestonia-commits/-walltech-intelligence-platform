# WALLTECH INTELLIGENCE PLATFORM — CURRENT STATE

Updated: 2026-08-18
Repository: ~/repos/walltech-intelligence-platform
Branch: main

## MILESTONE

Communication Intelligence Foundation v1 — CLOSED

## DONE

- Aruba IMAP connectivity verified for info@walltechgroup.eu.
- Aruba login verified.
- Sent mailbox identified as INBOX.Sent.
- Quectel July–August 2026 communication history reconstructed.
- Quectel operational CommunicationCycle object created.
- Generic CommunicationCycle JSON Schema created using JSON Schema Draft 2020-12.
- AJV installed.
- ajv-formats installed.
- Validator implemented with Ajv2020.
- Validator made generic: CommunicationCycle JSON supplied through CLI argument.
- Validator accepts the real Quectel CommunicationCycle.
- Validator accepts a second generic CommunicationCycle.
- Validator rejects an invalid CommunicationCycle missing required dealId.
- Schema JSON integrity verified.
- Quectel JSON integrity verified.
- Communication Intelligence Foundation v1 final acceptance test passed.

## FOUNDATION CONTRACT

Generic validation command:

    node src/mail/validate-communication-cycle.js <communication-cycle.json>

Optional explicit schema:

    node src/mail/validate-communication-cycle.js <communication-cycle.json> <schema.json>

Default schema:

    src/mail/communication-cycle.schema.json

## EVIDENCE

Positive real-object test:

    COMMUNICATION CYCLE: VALID
    DEAL: QUECTEL-EC21-2026-001

Positive generic-object test:

    COMMUNICATION CYCLE: VALID
    DEAL: FOUNDATION-V1-ACCEPTANCE-001

Negative structural test:

    COMMUNICATION CYCLE: INVALID
    missingProperty: dealId
    EXIT CODE: 1

Package contract:

    ajv: ^8.20.0
    ajv-formats: ^3.0.1

Final acceptance result:

    FOUNDATION V1 ACCEPTANCE: PASS

Technical baseline before Foundation completion:

    53362a48a112ef4e3a8fde7e74f74583dd7a8665

Foundation v1 implementation commit:

    d49594346ac9ed1dae970f906000c8b0be386c5b

## ACTIVE CYCLE

Aruba Mail Intelligence Automation

### DONE

- AZIONE 48 completed.
- Generic Aruba IMAP acquisition client created.
- ImapFlow installed.
- info@walltechgroup.eu INBOX acquisition verified.
- info@walltechgroup.eu INBOX.Sent acquisition verified.
- Mailboxes are opened in READ_ONLY mode.
- Acquisition output is structured JSON.
- Current metadata acquisition includes seq, UID, Message-ID, dates, subject, from, to, cc, reply-to, flags and message size.
- .env remains ignored by Git.
- Foundation v1 regression validation remains green.
- AZIONE 50 completed.
- Exact message acquisition by IMAP UID implemented.
- Full RFC822 message source acquisition verified.
- INBOX UID 17 acquired successfully in READ_ONLY mode.
- INBOX.Sent UID 10 acquired successfully in READ_ONLY mode.
- SHA-256 evidence generated for exact raw message source.
- Message byte count independently verified.
- IMAP flags verified unchanged before and after content acquisition.
- Raw evidence remains temporary and outside the Git repository.
- AZIONE 52 completed.
- RFC822 normalization layer implemented.
- PostalMime integrated for MIME/RFC822 parsing.
- Normalized text extraction verified.
- Normalized HTML extraction verified.
- Attachment metadata extraction verified.
- Attachment binary content is not stored in normalized JSON.
- Attachment size and SHA-256 are preserved as evidence metadata.
- Raw-message SHA-256 reference is preserved through normalization.
- Message-ID continuity from acquisition to normalization verified.
- INBOX UID 17 normalization verified.
- INBOX.Sent UID 10 normalization verified.
- Foundation and read-only mailbox regression gates remain green.
- AZIONE 54 completed.
- Persistent MailEvidence v1 contract implemented.
- MailEvidence JSON Schema Draft 2020-12 implemented.
- Generic MailEvidence builder implemented.
- Generic MailEvidence validator implemented.
- IMAP UIDVALIDITY added to exact-message acquisition.
- Persistent IMAP identity is mailbox + UIDVALIDITY + UID.
- INBOX UIDVALIDITY 1784554448 / UID 17 evidence verified.
- INBOX.Sent UIDVALIDITY 1784554450 / UID 10 evidence verified.
- Raw RFC822 SHA-256 continuity into MailEvidence verified.
- Normalized text and HTML SHA-256 continuity verified.
- Attachment metadata and SHA-256 continuity verified.
- Body content is not stored inside MailEvidence.
- Attachment binary content is not stored inside MailEvidence.
- Deterministic MailEvidence ID verified.
- Invalid MailEvidence schema input is rejected.
- Acquisition/normalization cross-link mismatch is rejected.
- Foundation regression remains green.

### EVIDENCE

INFO / INBOX:

    ARUBA MAIL ACQUISITION: PASS
    MODE: READ_ONLY
    TOTAL MESSAGES: 20
    FETCHED: 5

INFO / INBOX.Sent:

    ARUBA MAIL ACQUISITION: PASS
    MODE: READ_ONLY
    TOTAL MESSAGES: 10
    FETCHED: 5

Foundation regression:

    COMMUNICATION CYCLE: VALID
    DEAL: QUECTEL-EC21-2026-001

Message content acquisition:

    INBOX / UID 17
    ARUBA MESSAGE CONTENT ACQUISITION: PASS
    MODE: READ_ONLY
    SOURCE BYTES: 248036
    FLAGS UNCHANGED: true

    INBOX.Sent / UID 10
    ARUBA MESSAGE CONTENT ACQUISITION: PASS
    MODE: READ_ONLY
    SOURCE BYTES: 52825
    FLAGS UNCHANGED: true

Evidence integrity:

    RFC822 SOURCE: PASS
    SHA-256: PASS
    UID SELECTOR: PASS
    FLAGS UNCHANGED: true

RFC822 normalization:

    INBOX / UID 17
    NORMALIZATION: PASS
    TEXT CHARACTERS: 3265
    HTML CHARACTERS: 33586
    ATTACHMENTS: 3

    INBOX.Sent / UID 10
    NORMALIZATION: PASS
    TEXT CHARACTERS: 4457
    HTML CHARACTERS: 41206
    ATTACHMENTS: 0

Normalization contract:

    RAW SHA-256 REFERENCE: PRESERVED
    MESSAGE-ID CONTINUITY: PASS
    TEXT / HTML: EXTRACTED
    ATTACHMENT METADATA: EXTRACTED
    ATTACHMENT BINARY IN JSON: NOT STORED

MailEvidence Contract v1:

    INBOX / UIDVALIDITY 1784554448 / UID 17
    MAIL EVIDENCE: VALID
    EVIDENCE ID:
    ME-fea3dd270032446c25c6d9b323760dc694c0224070fdf688c913ba0b4e6ef155

    INBOX.Sent / UIDVALIDITY 1784554450 / UID 10
    MAIL EVIDENCE: VALID
    EVIDENCE ID:
    ME-0092fe49560909081981c82e6db8ac3390a8a991f211c86bf9d0506907838091

MailEvidence integrity:

    MAILBOX + UIDVALIDITY + UID: PASS
    RAW SHA-256 LINK: PRESERVED
    NORMALIZED HASH LINK: PRESERVED
    ATTACHMENT EVIDENCE: PRESERVED
    BODY BINARY IN EVIDENCE: NOT STORED
    ATTACHMENT BINARY IN EVIDENCE: NOT STORED
    EVIDENCE ID: DETERMINISTIC
    INVALID CONTRACT: REJECTED
    CROSS-LINK MISMATCH: REJECTED

### SECURITY NOTE

A mailbox message from comunicazioni@staff.aruba.it with subject
"Abbiamo rilevato accessi sospetti alla tua casella" was observed during acquisition.

This is recorded as evidence only.
It is not currently classified as a blocker and no separate security cycle has been opened.

### OPEN

- Automated acquisition orchestration.

### BLOCKED

None for the current Aruba Mail Intelligence acquisition cycle.

## OPEN

The following are intentionally outside Foundation v1 and have NOT been opened inside this milestone:

- automated Aruba mail intelligence
- second mailbox marketingdept@walltechgroup.eu
- communication cycle detection
- unanswered / follow-up detection
- evidence extraction
- CRM routing / integration
- campaign → lead → qualified communication → deal
- Production Statistics
- VFP / Revenue / Income evidence
- Time To Revenue
- Weekly Production Report
- progressive structuring of other Walltech deals

## BLOCKED

None for Communication Intelligence Foundation v1.

## NEXT ACTION

AZIONE 56 — create the end-to-end read-only MailEvidence orchestrator for the INFO mailbox, joining exact UID acquisition, RFC822 normalization, MailEvidence build and validation behind one controlled command.

Do not open communication-cycle detection, unanswered/follow-up detection, CRM routing or the marketing mailbox until acquisition orchestration is complete.

## OPERATING RULE

Git / repository is the technical source of truth.

One action at a time.
No new cycle is mixed into a currently open milestone.
Every milestone must leave evidence and an updated CURRENT_STATE.md.
