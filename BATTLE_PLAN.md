# WALLTECH MASTER BATTLE PLAN

Version: 1.0
Date: 2026-08-18
Owner: Walltech Group OÜ / Massimo Dongu
Status: ACTIVE

---

## MASTER VFP

Build a Walltech Operating System in which communication intelligence,
property opportunity intelligence, decision engines, payments, invoicing,
accounting evidence and geographic expansion operate as controlled,
measurable production cycles directed toward usable products, revenue
and expansion.

Technical work is valid only when it advances an operating product,
evidence quality, cycle closure, automation, revenue or scale.

---

## OPERATING RULE

Every Walltech project or cycle must have:

- VFP
- Baseline
- Target
- Statistic
- Owner
- Start Date
- Deadline
- Current Condition
- Next Action
- DONE Definition
- Evidence
- Time To Revenue

No uncontrolled project proliferation.

No new Engine before the preceding Engine reaches its defined Operating Gate,
unless Massimo explicitly changes priority.

---

# PROGRAM A — COMMUNICATION INTELLIGENCE

## VFP

Automatically read configured Walltech communication sources and produce
one reliable Actionable Communication Queue showing:

- communication relationship;
- real terminal;
- source account;
- latest direction;
- waiting party;
- response expectation where evidenced;
- communication age;
- deal/business routing;
- owner;
- evidence;
- operational classification;
- priority;
- revenue relevance;
- next action.

The VFP is NOT perfect semantic understanding of every email.

The VFP is an operational system that tells Walltech what requires action,
who must act, why, and with what evidence.

## Initial account scope

1. info@walltechgroup.eu
2. marketingdept@walltechgroup.eu
3. walltechgroup.estonia@gmail.com

## Future account-ready architecture

Future accounts must be addable through configuration and provider adapters,
without rebuilding the intelligence pipeline.

Candidate future accounts:

- cfi@walltechgroup.eu
- creditifiscali@walltechgroup.eu
- other project-specific Walltech accounts

Exact addresses must be verified before activation.

## Architecture

MAIL ACCOUNT CONFIG
        |
        v
PROVIDER ADAPTER
        |
        v
MailEvidence
        |
        v
Normalization
        |
        v
Communication Relationship
        |
        v
Response Expectation / Sequence
        |
        v
Routing
        |
        v
ACTIONABLE COMMUNICATION QUEUE
        |
        v
CRM / Deal / Owner / Revenue Priority

## Routing rule

If aliases or project addresses forward to a central mailbox and original
recipient evidence is preserved in message headers, routing should use that
evidence instead of requiring a separate acquisition pipeline.

If original-recipient evidence is not reliably preserved, configure that
mailbox as an independent source.

## Communication Intelligence v1 DONE

One controlled execution must be able to:

- scan configured mail sources;
- build verified communication relationships;
- preserve exact evidence;
- identify direction and chronology;
- exclude quoted-history false positives;
- identify explicit response expectations where evidenced;
- distinguish open expectation from later responder message;
- calculate waiting age;
- route to business/deal;
- identify owner;
- generate one Actionable Communication Queue;
- expose evidence;
- avoid unsupported commercial inference.

Minimum operational states:

- ACTION_REQUIRED
- WAITING_ON_COUNTERPARTY
- WAITING_ON_WALLTECH
- REVIEW_REQUIRED
- NO_ACTION / CLOSED where evidence supports it

## Current completed technical foundation

- Aruba read-only acquisition
- exact message acquisition by UID
- RFC822 normalization
- persistent MailEvidence
- Communication Cycle Detection
- Communication Sequence
- Response-State Evidence
- Response Expectation Evidence
- AUTHORED_TEXT_ONLY isolation
- quoted-history false-positive prevention
- Relationship Response Expectation

Deep semantic satisfaction analysis is PARKED for v1 unless production
evidence proves it necessary.

## Next Communication Intelligence production series

1. config-driven account registry
2. marketingdept acquisition
3. Gmail provider adapter
4. mailbox-range scanning
5. multi-account relationship aggregation
6. original-recipient / alias routing
7. business/deal routing
8. communication age / waiting time
9. operational state classification
10. Actionable Communication Queue
11. CRM/deal mapping
12. Communication Intelligence v1 DONE

---

# PROGRAM B — PROPERTY DECISION ENGINE

## Priority

Primary production priority in parallel with controlled closure of
Communication Intelligence.

## HARD OPERATING GATE

Thursday, 20 August 2026.

The deadline may move only for a verified technical blocker with:

- evidence;
- exact WHY;
- corrective action;
- new target.

## VFP

An operational Property Decision Engine where a real opportunity can move
end-to-end through:

opportunity acquisition
        |
        v
document acquisition
        |
        v
Procedure Intelligence
        |
        v
Property Intelligence
        |
        v
Creditor Intelligence where required
        |
        v
risk / economics / strategy
        |
        v
usable decision output
        |
        v
evidence traceability

The Operating Gate is an actual end-to-end acceptance test.

"More code written" is not the VFP.

## Technical source of truth

Repository:

~/repos/asset-opportunity-hub

This repository is separate from walltech-intelligence-platform.

---

# PROGRAM C — SWEDBANK / PAYMENTS

## VFP

Prepare the Engine for payment collection and reconciliation through
Walltech Group OÜ banking infrastructure without coupling bank-specific
logic to the Engine core.

## Target architecture

ENGINE / TRANSACTION
        |
        v
ORDER / SERVICE EVENT
        |
        v
INVOICE
        |
        v
PAYMENT REQUEST
        |
        v
SWEDBANK
        |
        v
PAYMENT EVIDENCE
        |
        v
RECONCILIATION
        |
        v
ACCOUNTING SYSTEM

## Preparation DONE

- payment adapter boundary
- transaction reference model
- invoice/payment relationship
- payment evidence model
- reconciliation boundary
- secrets outside repository
- no hardcoded Swedbank logic in Engine core

Bank integration must not become a blocker for the Engine Operating Gate
unless technically essential.

---

# PROGRAM D — ACCOUNTING AUTOMATION

## VFP

Automate invoices, payment evidence, reconciliation, expense acquisition
and monthly reporting while preserving required human accounting control.

## Flow

REVENUE
  -> Invoice
  -> Payment
  -> Reconciliation
  -> Accounting

EXPENSE
  -> Supplier document / receipt
  -> Acquisition
  -> Classification
  -> Accounting proposal
  -> Human review when required

MONTH END
  -> Reconciliation
  -> Reports
  -> Human accounting control
  -> Estonian tax reporting workflow

## Design rule

Automate mechanical work.

Do not eliminate necessary accounting control.

## Required discovery before implementation

- accounting software currently used
- API/integration capabilities
- invoice process
- expense process
- reconciliation process
- month-end reports
- Estonian reporting/export workflow used in practice

---

# PROGRAM E — ESTONIA PROPERTY ENGINE

## Opening Gate

Do not create an uncontrolled parallel Engine.

First current Property Decision Engine must reach its Operating Gate.

Then run Estonia Evaluation Gate.

## Estonia Evaluation Gate

Establish:

- official auction sources
- procedure sources
- cadastral/property sources
- document availability
- market volume
- data accessibility
- compliance boundaries
- monetization model
- target customer
- unit economics
- Time To Revenue
- quantitative targets
- deadline
- Go / No-Go

## Architecture target

PROPERTY DECISION ENGINE CORE
        |
        +-- Current Country Adapter
        |
        +-- Estonia Adapter
        |
        +-- Future Country Adapter X
        |
        +-- Future Country Adapter Y

Reuse core intelligence whenever structurally possible.

---

# PROGRAM F — INTERNATIONAL EXPANSION

## VFP

A repeatable country expansion system that evaluates markets before
development and allows Walltech to scale without rebuilding the platform.

Each country requires:

- market score
- source availability
- data/document accessibility
- compliance assessment
- monetization model
- technical adaptation effort
- expected revenue
- Time To Revenue
- investment required
- Go / No-Go
- target date

No country project starts merely because it appears interesting.

---

# TARGET SERIES

## 18 AUGUST 2026

Communication Intelligence:

- checkpoint Relationship Response Expectation
- freeze deep semantic expansion
- activate Master Battle Plan
- move next action to multi-account productization

Property Decision Engine:

- resume active Engine technical cycle
- protect 20 August Operating Gate

## 19 AUGUST 2026

Property Decision Engine:

- close critical blockers
- complete end-to-end path
- verify real evidence acquisition
- verify usable decision output
- prepare payment adapter boundary

## 20 AUGUST 2026

HARD OPERATING GATE:

PROPERTY DECISION ENGINE OPERATIONAL V1

Required acceptance:

- real opportunity
- real evidence/documents
- Procedure Intelligence
- Property Intelligence
- operational decision
- evidence traceability
- usable end-to-end result

---

# MANAGEMENT STATISTICS

## Communication Intelligence

- configured accounts
- messages acquired
- relationships detected
- action-required cycles
- waiting-on-Walltech
- waiting-on-counterparty
- review-required
- overdue cycles
- average waiting age
- response time
- revenue-critical cycles
- routing accuracy
- false-positive rate

## Property Decision Engine

- opportunities acquired
- documents acquired
- document coverage
- procedures parsed
- opportunities reaching decision output
- decision cycle time
- blocked opportunities
- evidence completeness
- acceptance tests passed
- revenue opportunities generated

## Payments / Accounting

- invoices issued
- payments requested
- payments received
- reconciliation rate
- unreconciled transactions
- expenses acquired
- expenses requiring review
- month-end completeness
- manual interventions

## Expansion

- countries evaluated
- Go decisions
- No-Go decisions
- adapters activated
- opportunities sourced
- revenue by country
- Time To Revenue

---

# ANTI-DEV-T RULES

1. Do not optimize beyond the next required VFP.
2. Technical elegance is not an operating product.
3. Every new layer must improve evidence, decision quality, automation,
   closure, revenue or scale.
4. Otherwise PARK it.
5. Deep semantic analysis is deferred unless production requires it.
6. Do not duplicate provider pipelines where adapters/configuration suffice.
7. No new Engine without an Operating Gate for the previous one.
8. Every missed deadline requires evidence-based WHY and correction.
9. Every new cycle requires a DONE definition before development.
10. Repository evidence overrides conversational assumptions.

---

# CURRENT EXECUTIVE PRIORITY

1. Checkpoint current Communication Intelligence relationship layer.
2. Productize Communication Intelligence toward multi-account actionable queue.
3. Property Decision Engine Operational Gate — 20 August 2026.
4. Prepare payment adapter architecture.
5. Integrate Swedbank without blocking Engine.
6. Design accounting automation with human control.
7. Run Estonia Evaluation Gate.
8. Start international expansion only against measurable targets.

---

# MASTER DONE CONDITION

Walltech is advancing correctly when:

- VFPs are explicit;
- deadlines exist;
- statistics measure production;
- technical work maps to operating products;
- evidence is preserved;
- usable products reach DONE;
- revenue paths are visible;
- project proliferation is controlled;
- expansion follows evaluation gates.

This Battle Plan is a stable management reference.

Future cycles must reference this Battle Plan or an explicitly approved
successor.
