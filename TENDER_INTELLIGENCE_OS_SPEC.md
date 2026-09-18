# TENDER INTELLIGENCE OS
## Product, Architecture & Engineering Specification

VERSION: 1.0
STATUS: MASTER BUILD SPECIFICATION
PLATFORM: WEB APPLICATION
PRIMARY MARKET: SOUTH AFRICA
PRIMARY USERS: DESIGN, MEDIA, ADVERTISING, PRINT, DIGITAL, VIDEO AND CREATIVE AGENCIES

---

# 1. PRODUCT PURPOSE

Build a production-grade Tender Intelligence and Bid Automation platform for South African agencies.

The system must continuously discover relevant open tenders, verify them against authoritative sources, analyse tender documents, determine whether the agency should bid, calculate an opportunity score, identify compliance requirements, develop a bid strategy, match relevant agency evidence and case studies, generate proposal content, red-team the proposal, perform final compliance checks and track the outcome.

The core workflow is:

DISCOVER
→ VERIFY
→ NORMALISE
→ CLASSIFY
→ QUALIFY
→ EXTRACT REQUIREMENTS
→ EXTRACT EVALUATION CRITERIA
→ SCORE
→ BID / NO-BID
→ DEVELOP STRATEGY
→ MATCH EVIDENCE
→ GENERATE BID
→ RED TEAM
→ COMPLIANCE CHECK
→ FINAL SUBMISSION PACK
→ TRACK OUTCOME
→ LEARN

---

# 2. CORE PRODUCT PRINCIPLE

This is NOT a generic AI chatbot.

It is a procurement intelligence system with AI capabilities.

The application must prioritise:

1. Accuracy
2. Procurement compliance
3. Traceability
4. Evidence
5. Reliability
6. Security
7. Maintainability
8. Explainability
9. Human review
10. Automation

AI should assist the user but must never silently invent procurement or agency information.

---

# 3. CRITICAL AI RULE

NEVER FABRICATE INFORMATION.

The system must never invent:

- tender requirements
- tender deadlines
- tender values
- evaluation criteria
- agency credentials
- company experience
- clients
- case studies
- results
- staff
- qualifications
- certifications
- references
- turnover
- B-BBEE status
- tax status
- pricing
- competitor information
- award information
- winning probability

If information is unavailable:

UNKNOWN

If information is inferred:

INFERRED

If information is supported by an authoritative source:

VERIFIED

If information lacks evidence:

UNVERIFIED

UNVERIFIED INFORMATION MUST NOT BE PRESENTED AS FACT.

---

# 4. SOUTH AFRICAN PROCUREMENT CONTEXT

The system is initially designed for South African procurement.

Priority sources include:

- eTenders
- National Treasury
- Government departments
- Provincial governments
- Municipalities
- State-owned entities
- Universities
- Public entities
- Official institutional procurement portals

Secondary sources may include:

- EasyTenders
- TenderAlerts
- TenderBulletins
- industry-specific tender aggregators

Aggregators are discovery sources.

The original tender document remains authoritative.

Always preserve the original source URL and original documents.

---

# 5. IMPORTANT COVERAGE RULE

Do NOT claim that the system has discovered "every tender on the internet."

Instead report:

"All opportunities discovered across the configured tender-source network."

The application must show:

- number of sources
- source health
- last successful scan
- failed sources
- scan coverage
- last scan timestamp

This creates transparency around coverage.

---

# 6. SERVICE TAXONOMY

The system must initially support:

- Graphic Design
- Print
- Digital
- Video
- Photography
- Branding
- Advertising
- Media Buying
- Media Planning
- Social Media
- Content
- Publishing
- Web Design
- Web Development
- Animation
- Motion Graphics
- Events
- Communications
- Marketing
- Public Relations
- Creative Services

The taxonomy must be configurable.

Do NOT hard-code the taxonomy into the application.

The administrator must be able to add:

- services
- categories
- subcategories
- keywords
- exclusions
- synonyms

---

# 7. HIGH-LEVEL ARCHITECTURE

TENDER INTELLIGENCE OS

├── FRONTEND
│   ├── React
│   ├── Vite
│   ├── TypeScript
│   ├── Tailwind CSS
│   └── shadcn/ui
│
├── BACKEND
│   ├── Node.js
│   ├── TypeScript
│   ├── REST API
│   ├── Background Workers
│   └── Job Queue
│
├── DATABASE
│   ├── PostgreSQL
│   ├── Supabase
│   ├── pgvector
│   └── Row Level Security
│
├── AI
│   ├── Discovery Agent
│   ├── Classification Agent
│   ├── Qualification Agent
│   ├── Requirement Agent
│   ├── Evaluation Agent
│   ├── Scoring Agent
│   ├── Strategy Agent
│   ├── Portfolio Matcher
│   ├── Bid Writer
│   ├── Red Team Agent
│   └── Compliance Agent
│
├── SCRAPING
│   ├── Source Adapters
│   ├── Browser Automation
│   ├── Document Discovery
│   └── Source Health Monitoring
│
├── DOCUMENT PROCESSING
│   ├── PDF
│   ├── DOCX
│   ├── XLSX
│   ├── PPTX
│   ├── HTML
│   └── OCR
│
└── INTELLIGENCE
    ├── Tender Database
    ├── Agency Knowledge Base
    ├── Awards
    ├── Competitors
    └── Analytics

---

# 8. TECHNOLOGY STACK

Frontend:

React
Vite
TypeScript
Tailwind CSS
shadcn/ui

Backend:

Node.js
TypeScript
REST API

Database:

PostgreSQL
Supabase
pgvector

Authentication:

Supabase Auth

Storage:

Supabase Storage

AI:

OpenAI API

Scraping:

Apify
Playwright where required

Background processing:

Redis
BullMQ
or equivalent reliable queue architecture

Testing:

Vitest
Playwright
API integration tests

Validation:

Zod

---

# 9. APPLICATION ROUTES

Create:

/
/tenders
/tenders/:id
/opportunities
/watchlist
/bids
/bids/:id
/bids/:id/strategy
/bids/:id/compliance
/bids/:id/documents
/agency
/agency/capabilities
/agency/portfolio
/agency/team
/agency/documents
/analytics
/competitors
/sources
/settings

---

# 10. DASHBOARD

The main dashboard must show:

- Open tenders
- Relevant tenders
- Priority bids
- Tenders closing within 7 days
- Upcoming briefings
- Active bids
- Estimated opportunity value
- Compliance readiness
- Recent addenda
- Source health
- Recent awards

Primary visual language:

Bloomberg Terminal
+
Linear
+
Notion
+
ChatGPT

But simplified.

The UI must feel:

- professional
- intelligent
- fast
- information dense
- highly scannable
- premium
- modern

Avoid:

- excessive gradients
- unnecessary animations
- generic SaaS cards
- oversized dashboard graphics
- excessive rounded containers
- "AI gimmick" UI

---

# 11. TENDER DETAIL PAGE

Tabs:

Overview
Requirements
Evaluation
Briefing
Documents
Addenda
Qualification
Opportunity Score
Risk Score
Bid Strategy
Portfolio Matches
Compliance
Activity

Primary actions:

VIEW DOCUMENTS
BID
NO-BID
WATCH
ASSIGN
GENERATE STRATEGY

---

# 12. DATABASE MODEL

Minimum entities:

users

agencies

agency_services

agency_team

agency_documents

agency_certificates

agency_case_studies

agency_clients

agency_references

agency_policies

tender_sources

tenders

tender_documents

tender_addenda

tender_requirements

tender_evaluation

tender_briefings

tender_embeddings

tender_scores

tender_status_history

bid_projects

bid_sections

bid_requirements

bid_evidence

bid_documents

bid_versions

bid_reviews

bid_submissions

awards

competitors

competitor_activity

notifications

audit_logs

All records should use UUID primary keys.

All major records must contain:

id
created_at
updated_at

Agency-owned records must include:

agency_id

This allows future multi-tenancy.

---

# 13. TENDER FIELDS

`tenders`

Must support:

id
tender_number
title
organisation
entity_type
province
municipality
category
subcategories
description
published_date
closing_date
closing_time
briefing_required
briefing_date
briefing_location
briefing_url
estimated_value
contract_duration
submission_method
submission_url
submission_email
source_url
original_document_url
status
confidence_score
discovered_at
verified_at

Additional fields may be added where useful.

---

# 14. SOURCE REGISTRY

Every source must have:

source_id
name
url
source_type
authority_level
jurisdiction
scan_frequency
active
requires_login
supports_documents
last_scan
last_success
error_count
health_status

Health states:

HEALTHY
WARNING
FAILED
DISABLED

---

# 15. SOURCE ADAPTER

Use a standard interface:

interface TenderSourceAdapter {
  discover(): Promise<TenderDiscovery[]>
  fetchDetails(id: string): Promise<TenderDetails>
  fetchDocuments(id: string): Promise<DocumentReference[]>
  healthCheck(): Promise<SourceHealth>
}

Every source must use this architecture.

Do not build each scraper as an unrelated implementation.

---

# 16. SCRAPING RULES

Respect:

- robots.txt
- terms of service
- rate limits
- authentication boundaries

Never:

- bypass CAPTCHA
- bypass authentication
- defeat anti-bot protections
- scrape restricted content illegally

If a source cannot be automatically accessed:

record the source

mark it as requiring manual ingestion

do not silently ignore it.

---

# 17. DEDUPLICATION

Tender duplication must be detected using:

- tender number
- organisation
- title similarity
- closing date
- source
- document fingerprint

A canonical tender record should be created.

Multiple source appearances should be associated with the canonical tender.

---

# 18. ADDENDA

The system must detect:

- new addenda
- revised tender documents
- changed closing dates
- changed requirements
- changed evaluation criteria
- changed submission instructions

For every new addendum:

1. download it
2. hash it
3. compare with previous version
4. identify changes
5. identify affected requirements
6. identify affected bid sections
7. notify the user

---

# 19. DOCUMENT PIPELINE

Pipeline:

DOWNLOAD
→ FILE HASH
→ MIME DETECTION
→ TEXT EXTRACTION
→ OCR IF REQUIRED
→ PAGE SEGMENTATION
→ CHUNKING
→ METADATA
→ EMBEDDING
→ STORAGE

Support:

PDF
DOCX
XLSX
PPTX
HTML
scanned documents

Every extracted requirement must retain:

source document
page
section
source text

---

# 20. AI AGENTS

Do NOT create one giant AI prompt.

Use separate agents.

1. Discovery / Classification Agent

Determines whether a tender is relevant.

2. Qualification Agent

Determines whether the agency appears eligible.

3. Requirement Extraction Agent

Extracts mandatory and non-mandatory requirements.

4. Evaluation Agent

Extracts actual evaluation methodology.

5. Opportunity Scoring Agent

Provides evidence used for scoring.

6. Risk Agent

Identifies bid risks.

7. Bid Strategy Agent

Develops strategic positioning.

8. Portfolio Matching Agent

Finds relevant agency evidence.

9. Bid Writing Agent

Generates proposal content.

10. Red Team Agent

Attempts to identify why the proposal could fail.

11. Submission Compliance Agent

Performs final submission validation.

Each agent must have:

- explicit input schema
- explicit output schema
- confidence
- evidence
- validation
- failure handling

---

# 21. FACT / INFERENCE / RECOMMENDATION

Every intelligence output must distinguish:

FACT

INFERENCE

RECOMMENDATION

Example:

FACT:
Tender awards 20 points for experience.

INFERENCE:
Experience is likely to be a major differentiator.

RECOMMENDATION:
Use three highly relevant case studies demonstrating measurable results.

---

# 22. OPPORTUNITY SCORE

Default score:

Service Fit = 20
Qualification Likelihood = 20
Relevant Experience = 15
Functionality Potential = 15
Commercial Value = 10
Competition = 5
Time Available = 5
Compliance Risk = 5
Strategic Value = 5

Total = 100

Classes:

90–100 = PRIORITY BID
80–89 = BID
70–79 = REVIEW
60–69 = CONDITIONAL
<60 = NO-BID

IMPORTANT:

Mandatory qualification failures override the score.

Example:

Score = 94

Mandatory accreditation = missing

Result:

NO-BID

The deterministic application layer calculates the final score.

AI provides evidence and recommendations.

---

# 23. RISK SCORE

Risk must be separately calculated.

Consider:

- missing documents
- mandatory uncertainty
- compulsory briefing
- short deadline
- weak experience
- capacity
- complex submission
- pricing pressure
- unclear scope
- mandatory accreditation
- turnover threshold
- geographic restrictions

---

# 24. QUALIFICATION ENGINE

Check:

- CSD
- tax compliance
- B-BBEE
- company registration
- turnover
- years in business
- relevant experience
- references
- certifications
- registrations
- compulsory briefing
- JV requirements
- subcontracting requirements
- insurance
- capacity
- geographic requirements

Statuses:

PASS
FAIL
UNKNOWN
REQUIRES ACTION

Never treat UNKNOWN as PASS.

---

# 25. AGENCY KNOWLEDGE BASE

Create:

agency-data/

company/
portfolio/
case-studies/
team/
certificates/
policies/
previous-bids/
templates/

The system must index this information.

Use semantic search and embeddings.

If the system cannot find evidence for a capability:

NOT FOUND

Never invent it.

---

# 26. CASE STUDY STRUCTURE

Each case study should support:

Project
Client
Industry
Services
Year
Budget
Deliverables
Challenge
Solution
Results
Team
Images
URL
Reference Contact

---

# 27. EVIDENCE GRAPH

The system should eventually represent:

Tender Requirement
        ↓
Bid Section
        ↓
Agency Evidence
        ↓
Generated Claim

Every important claim in a generated proposal should be traceable to agency evidence.

---

# 28. BID STRATEGY

Generate:

- buyer priorities
- tender priorities
- evaluation focus
- agency strengths
- agency weaknesses
- competitive risks
- recommended positioning
- winning themes
- recommended case studies
- methodology
- risk mitigation

Separate:

FACT
INFERENCE
RECOMMENDATION

---

# 29. BID GENERATION

Default structure:

Cover
Confidentiality
Contents
Executive Summary
Understanding of Requirement
Interpretation of Brief
Proposed Solution
Creative Approach
Methodology
Implementation Plan
Timeline
Team
Relevant Experience
Case Studies
Quality Assurance
Risk Management
Reporting
Measurement / KPIs
Social / Economic Impact
Pricing
Declarations
Supporting Documents
Appendices

The structure must adapt to the actual tender.

Never blindly generate every section.

---

# 30. INTERNAL BID MATRIX

Every bid should support:

Tender Requirement
→ Bid Section
→ Evidence
→ Response
→ Score Potential
→ Review Status

---

# 31. RED TEAM

The red-team agent acts as the evaluation committee.

It should identify:

- missing requirements
- weak answers
- unsupported claims
- generic language
- contradictions
- missing evidence
- incorrect tender number
- incorrect dates
- pricing errors
- missing signatures
- missing forms
- certificate problems
- addendum conflicts

Severity:

CRITICAL
HIGH
MEDIUM
LOW

Each issue must include:

problem
location
reason
recommended fix

---

# 32. FINAL COMPLIANCE

The system must verify:

- tender number
- closing date
- closing time
- submission method
- signatures
- forms
- pricing schedules
- certificates
- CSD
- B-BBEE
- tax
- references
- required experience
- briefing attendance
- addenda
- page requirements
- certified documents
- JV documents
- required accreditation

Final state:

READY

or

BLOCKED

Never show READY when mandatory issues remain unresolved.

---

# 33. DEADLINE ENGINE

Track:

Tender closing date
Briefing date
Internal deadline
Review deadline
Finalisation deadline

Default reminders:

14 days
7 days
3 days
24 hours
2 hours

Make configurable.

---

# 34. NOTIFICATIONS

Initially support:

- in-app
- email

Events:

new high-priority tender
closing soon
briefing upcoming
new addendum
document expiry
compliance failure
bid ready
red-team issue
deadline approaching

---

# 35. AWARDS

Track:

tender
winner
award value
award date
source
confidence

Labels:

VERIFIED
ESTIMATED
INFERRED

---

# 36. COMPETITOR INTELLIGENCE

Track:

competitor
tenders entered
tenders won
categories
organisations
award values
success rate

Do not fabricate competitor data.

---

# 37. ANALYTICS

Support:

tender volume
tender value
category
province
organisation
bid/no-bid ratio
win/loss
average score
average award value
competitor activity
time to submit
loss reasons

---

# 38. SECURITY

Use:

Supabase Auth
RLS
private storage
signed URLs
server-side API keys
audit logs
RBAC
input validation
rate limiting
secure file handling

Never expose:

OpenAI keys
scraper credentials
database credentials

to the browser.

---

# 39. ROLES

ADMIN
BID_MANAGER
RESEARCHER
WRITER
REVIEWER
VIEWER

Permissions must be explicit.

---

# 40. API

Implement:

GET /api/tenders
GET /api/tenders/:id
GET /api/tenders/:id/documents
GET /api/tenders/:id/requirements
GET /api/tenders/:id/evaluation
GET /api/tenders/:id/score
GET /api/tenders/:id/strategy
GET /api/tenders/:id/compliance

GET /api/bids
GET /api/bids/:id
POST /api/bids/:id/generate
POST /api/bids/:id/review
GET /api/bids/:id/export

GET /api/agency
GET /api/agency/services
GET /api/agency/documents
GET /api/agency/case-studies
GET /api/agency/team

GET /api/sources

GET /api/analytics

GET /api/notifications

Use Zod validation for request/response contracts.

---

# 41. PROJECT STRUCTURE

tender-intelligence/

├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── components/
│   │       ├── pages/
│   │       ├── layouts/
│   │       ├── hooks/
│   │       ├── lib/
│   │       └── types/
│   │
│   └── api/
│
├── agents/
│   ├── discovery/
│   ├── classifier/
│   ├── qualification/
│   ├── compliance/
│   ├── evaluation/
│   ├── scoring/
│   ├── strategy/
│   ├── portfolio/
│   ├── writer/
│   └── redteam/
│
├── scrapers/
│   ├── etenders/
│   ├── treasury/
│   ├── easytenders/
│   ├── municipalities/
│   ├── soe/
│   └── generic/
│
├── workers/
│   ├── scraping/
│   ├── documents/
│   ├── embeddings/
│   ├── analysis/
│   └── notifications/
│
├── documents/
│   ├── extraction/
│   ├── generation/
│   └── templates/
│
├── database/
│   ├── migrations/
│   └── seeds/
│
├── shared/
│   ├── types/
│   ├── schemas/
│   ├── constants/
│   └── utilities/
│
├── tests/
│
├── infrastructure/
│
└── docs/

---

# 42. TESTING

Required:

Unit tests
Integration tests
Scraper tests
AI schema tests
Database tests
API tests
E2E tests

Critical E2E:

DISCOVER TENDER
→ OPEN TENDER
→ EXTRACT REQUIREMENTS
→ EXTRACT EVALUATION
→ SCORE
→ CREATE BID
→ GENERATE STRATEGY
→ GENERATE PROPOSAL
→ RED TEAM
→ COMPLIANCE
→ EXPORT

---

# 43. FAILURE HANDLING

Scraper failure:

Mark source unhealthy.

AI failure:

Preserve tender data.

Document extraction failure:

Mark document requiring review.

OCR failure:

Allow manual reprocessing.

Do not silently discard failures.

Every important job should have:

status
started_at
completed_at
error
retry_count

---

# 44. DEVELOPMENT PRINCIPLES

Claude must:

- inspect the repository before coding
- understand existing architecture
- avoid overwriting working code
- work incrementally
- use reusable components
- use typed interfaces
- use schema validation
- write tests
- run build
- run typecheck
- run lint
- report failures honestly

DO NOT:

- build the entire application in one pass
- create a giant monolithic component
- create fake production data and present it as real
- hard-code tender information
- hard-code service categories
- put secrets in frontend code
- create placeholder AI functionality that looks real
- silently ignore errors
- optimise for code volume

OPTIMISE FOR:

correctness
traceability
maintainability
testability
procurement accuracy
compliance
evidence
security

---

# 45. MVP DEFINITION

The first working MVP should stop at:

1. Project foundation
2. Database
3. Authentication
4. Agency profile
5. Tender dashboard
6. Source registry
7. eTenders ingestion
8. Document ingestion
9. Tender classification
10. Requirement extraction
11. Evaluation extraction
12. Opportunity scoring

This creates:

TENDER RADAR

Only after Tender Radar is stable should the system move into:

Bid strategy
Portfolio matching
Proposal generation
Red-team
Compliance
Submission pack
Awards
Competitor intelligence

---

# 46. DEFINITION OF DONE

A feature is NOT complete simply because code exists.

A feature is complete only when:

- implemented
- typed
- validated
- tested
- integrated
- error handled
- documented
- build passes
- typecheck passes
- lint passes
- relevant E2E passes

---

# 47. FINAL DEVELOPMENT RULE

NEVER OPTIMISE FOR CODE VOLUME.

OPTIMISE FOR:

CORRECTNESS
TRACEABILITY
MAINTAINABILITY
TESTABILITY
PROCUREMENT ACCURACY
COMPLIANCE
EVIDENCE
SECURITY

END OF MASTER SPECIFICATION
