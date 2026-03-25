# MyWallet Implementation Status

**Last Updated**: March 25, 2026
**Phase**: Phase 3 - AI Pipeline
**Status**: Production base stable. Phase 3 AI pipeline implemented — deploy LiteLLM, seed pipeline steps, and redeploy worker to activate.

---

## 🎯 Project Overview

An expense tracking system that automatically extracts bank transactions from Gmail emails.

**Stack:**
- **Temporal.io** — durable workflow orchestration (self-hosted on Raspberry Pi k3s cluster)
- **Gmail API** — OAuth2 + Pub/Sub push notifications for real-time email sync
- **LiteLLM** — AI gateway proxy (OpenAI-compatible, routes to any provider: OpenAI, Ollama, Anthropic, Groq, etc.)
- **OpenAI / Ollama** — AI providers accessed via LiteLLM gateway
- **MongoDB** — multi-tenant data storage
- **Express** — REST API with OpenAPI/Swagger docs
- **Kubernetes (k3s)** — deployed on Raspberry Pi cluster via Helm

**Production URLs:**
| Service | URL |
|---------|-----|
| API | https://wallet.rotbyte.com/api |
| API Docs (ReDoc) | https://wallet.rotbyte.com/docs/reference |
| API Docs (Scalar) | https://wallet.rotbyte.com/docs/playground |
| OpenAPI JSON | https://wallet.rotbyte.com/docs/openapi.json |
| Temporal UI | https://temporal.rotbyte.com |

**Infrastructure:**
- Kubernetes namespace: `wallet` on k3s cluster
- Docker images: `ghcr.io/rocketbyte/mywallet-backend-api:dev` and `mywallet-temporal-worker:dev`
- Helm chart: `k8s/mywallet/`
- CI/CD: GitHub Actions → build multi-arch Docker images → `helm upgrade` → `kubectl rollout status`

---

## ✅ Completed Work

---

## 🗄️ Database Schema — Current State

**Last reviewed**: March 21, 2026
6 collections in use. One active migration in progress (`emails` → `notifications` + `transactions` refactor).

---

### `emails` ⚠️ being replaced
Raw emails mixed with processing state in one document. Being split into `notifications` (raw) + updated `transactions` (processed result).

| Field | Type | Notes |
|---|---|---|
| `userId` | String | Tenant identifier |
| `emailId` | String | Gmail message ID |
| `threadId` | String | Gmail thread ID |
| `from`, `to`, `subject` | String | Email headers |
| `date` | Date | Email sent date |
| `body` | String | Plain text body |
| `snippet` | String | Gmail preview |
| `rawHtml` | String | Original HTML |
| `isProcessed` | Boolean | Processing pipeline state |
| `processedAt` | Date | When processed |
| `processingWorkflowId` | String | Temporal workflow that processed it |
| `matchedPatternId/Name` | String | Which pattern matched |
| `transactionId` | String | Link to extracted transaction |
| `confidence` | Number | AI extraction confidence |
| `processingError` | String | Error if processing failed |
| `fetchedAt` | Date | When our system received it |
| `fetchedBy` | String | Which workflow fetched it |

**Problems**: mixes immutable raw data with mutable processing state; `emailId`/`threadId` are Gmail-specific field names; `rawHtml` is optional but needed for reprocessing.

---

### `transactions`
AI-extracted structured financial data. Currently duplicates several raw email fields.

| Field | Type | Notes |
|---|---|---|
| `userId` | String | Tenant identifier |
| `emailId` | String | Source Gmail message ID ⚠️ duplicated from emails |
| `emailSubject` | String | ⚠️ duplicated from emails |
| `emailDate` | Date | ⚠️ duplicated from emails |
| `emailFrom` | String | ⚠️ duplicated from emails |
| `rawEmailText` | String | ⚠️ duplicated from emails |
| `transactionDate` | Date | Extracted transaction date |
| `merchant` | String | Extracted merchant name |
| `amount` | Number | Extracted amount |
| `currency` | String | ISO 4217 (USD, DOP, EUR...) |
| `category` | String | Food, Transport, Shopping, etc. |
| `subcategory` | String | Optional sub-classification |
| `transactionType` | String | `debit` or `credit` |
| `accountNumber` | String | Last 4 digits |
| `bankName` | String | Bank name |
| `extractedData` | Mixed | Raw AI response |
| `confidence` | Number | 0–1 extraction confidence score |
| `workflowId` | String | Temporal workflow that extracted it |
| `workflowRunId` | String | Temporal run ID |
| `processedAt` | Date | When extracted |

**Problems**: `emailId`, `emailSubject`, `emailDate`, `emailFrom`, `rawEmailText` are all denormalized copies of data in `emails` — these will be replaced by a single `notificationId` reference once the migration is complete.

---

### `gmail_accounts`
One record per linked Gmail account. Manages OAuth tokens and watch subscription lifecycle.

| Field | Type | Notes |
|---|---|---|
| `userId` | String | Unique — one Gmail account per user |
| `email` | String | Gmail address |
| `refreshToken` | String | Long-lived OAuth token (select: false) |
| `currentAccessToken` | String | Short-lived token (select: false) |
| `accessTokenExpiresAt` | Date | Token expiry |
| `watchExpiration` | Date | Gmail watch subscription expiry (7-day max) |
| `historyId` | String | Last processed Gmail history ID |
| `lastSyncAt` | Date | Last successful sync |
| `workflowId` | String | Associated Temporal workflow ID |
| `isActive` | Boolean | Whether sync is running |
| `pubSubTopicName` | String | GCP Pub/Sub topic name |
| `pubSubSubscription` | String | GCP Pub/Sub subscription ID |
| `totalEmailsSynced` | Number | Cumulative sync counter |
| `lastError` | String | Last error message |
| `errorCount` | Number | Error counter |

**Problems**: collection name and fields are Gmail-specific. When Outlook support is added this should become a generic `linked_accounts` collection with a `provider` field (same pattern as `IEmailProvider` abstraction in the API layer).

---

### `email_patterns`
Rules used to recognize bank transaction emails and guide AI extraction.

| Field | Type | Notes |
|---|---|---|
| `name` | String | Unique pattern name |
| `bankName` | String | e.g. Chase, Banreservas |
| `accountType` | String | `credit`, `debit`, `checking`, `savings` |
| `fromAddresses` | String[] | Sender email addresses to match |
| `subjectPatterns` | String[] | Regex patterns for subject matching |
| `bodyKeywords` | String[] | Keywords to confirm match |
| `extractionPrompt` | String | AI prompt used for data extraction |
| `isActive` | Boolean | Whether pattern is in use |
| `priority` | Number | Match priority (higher = checked first) |
| `matchCount` | Number | Total times this pattern matched |
| `successRate` | Number | Successful extraction rate |
| `lastMatchedAt` | Date | Last time it matched an email |

**Problems**: `fromAddresses` and `subjectPatterns` work fine for Gmail but are also valid for any IMAP/SMTP provider — no changes needed now. `extractionPrompt` is AI-agnostic (plain text). No migration needed.

---

### `budgets`
Monthly spending budget allocations per user.

| Field | Type | Notes |
|---|---|---|
| `userId` | String | Tenant identifier |
| `month` | Number | 1–12 |
| `year` | Number | e.g. 2026 |
| `categories` | Array | `{ category, budgetAmount, spentAmount, transactionCount }` |
| `totalBudget` | Number | Sum of all category budgets |
| `totalSpent` | Number | Sum of all actual spending |
| `lastCalculatedAt` | Date | Last recalculation timestamp |

**Problems**: none. No migration needed.

---

### `schedule_configs`
Configuration for Temporal schedules that poll Gmail on a cron.

| Field | Type | Notes |
|---|---|---|
| `userId` | String | Tenant identifier |
| `scheduleId` | String | Unique Temporal schedule ID |
| `name` | String | User-friendly name |
| `description` | String | Optional |
| `isActive` | Boolean | Whether schedule is running |
| `searchQuery` | String | ⚠️ Gmail search query string |
| `cronExpression` | String | Cron schedule (default: every minute) |
| `maxResults` | Number | Max emails per run |
| `afterDate` | Date | Only fetch emails after this date |
| `skipProcessed` | Boolean | Skip emails already in DB |
| `totalRuns` | Number | Cumulative run counter |
| `lastRunAt` | Date | Last run timestamp |
| `lastRunStatus` | String | `success` or `failure` |
| `totalEmailsFetched` | Number | Cumulative emails fetched |
| `totalEmailsProcessed` | Number | Cumulative emails processed |
| `totalErrors` | Number | Cumulative error count |
| `createdBy` | String | Creator user ID |

**Problems**: `searchQuery` is a Gmail-specific search syntax string. When other providers are added, this field will need to become provider-agnostic (e.g. a structured filter object). Low priority — deferred to when a second provider is added.

---

### Migration Roadmap

| Collection | Status | Action |
|---|---|---|
| `emails` | ⚠️ Active migration | Replace with `notifications` (Phase 1–5, see plan below) |
| `transactions` | ⚠️ Needs refactor | Remove duplicated email fields, add `notificationId` ref |
| `gmail_accounts` | 🔵 Deferred | Rename to `linked_accounts` + add `provider` field when Outlook added |
| `email_patterns` | ✅ No action needed | Vendor-agnostic already |
| `budgets` | ✅ No action needed | Clean |
| `schedule_configs` | 🔵 Deferred | `searchQuery` becomes structured filter when second provider added |

---

### Planned: `notifications` (replaces `emails`)
Immutable raw record. Saved once when the message arrives from any provider. Never updated except for `status`.

| Field | Type | Notes |
|---|---|---|
| `userId` | String | Tenant identifier |
| `provider` | String | `gmail`, `outlook`, `yahoo`, etc. (open string) |
| `providerMessageId` | String | Provider's own message ID |
| `providerThreadId` | String | Thread/conversation ID |
| `from` | String | Sender address |
| `to` | String | Recipient address |
| `subject` | String | Email subject |
| `receivedAt` | Date | When the bank sent it |
| `bodyText` | String | Plain text (HTML stripped) |
| `bodyHtml` | String | Original HTML — required, not optional |
| `snippet` | String | Short preview |
| `status` | String | `pending`, `processing`, `processed`, `failed`, `ignored` |
| `ingestedAt` | Date | When our system received it |
| `ingestedBy` | String | Workflow/process ID that ingested it |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

**Compound unique index**: `{ userId, providerMessageId }` — per-tenant deduplication.

---

### Planned: `transactions` (after refactor)
Removes all denormalized email fields. References `notifications` instead.

| Field | Type | Notes |
|---|---|---|
| `userId` | String | Tenant identifier |
| `notificationId` | ObjectId | Reference to `notifications._id` |
| `transactionDate` | Date | Extracted transaction date |
| `merchant` | String | Extracted merchant name |
| `amount` | Number | Extracted amount |
| `currency` | String | ISO 4217 |
| `type` | String | `debit` or `credit` |
| `category` | String | Food, Transport, Shopping, etc. |
| `subcategory` | String | Optional |
| `accountLast4` | String | Last 4 digits of card/account |
| `bankName` | String | Bank name |
| `referenceNumber` | String | Bank reference/approval code |
| `patternId` | String | Which EmailPattern matched |
| `patternName` | String | Pattern name at extraction time |
| `confidence` | Number | 0–1 AI extraction confidence |
| `status` | String | `pending_review`, `confirmed`, `rejected` |
| `extractedAt` | Date | When extracted |
| `workflowId` | String | Temporal workflow that extracted it |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

**Removed from current model**: `emailId`, `emailSubject`, `emailDate`, `emailFrom`, `rawEmailText`, `extractedData` (raw AI response), `workflowRunId`.
**Renamed**: `transactionType` → `type`, `accountNumber` → `accountLast4`.
**Added**: `notificationId`, `referenceNumber`, `status`, `patternId`, `patternName`.

---

### Phase 2 — Production Bug Fixes (March 2026)

#### 15. End-to-End Gmail Sync Pipeline (100%)

All bugs in the real-time email sync pipeline have been resolved. The system now correctly:
1. Receives a Gmail Pub/Sub webhook notification
2. Signals the running `gmailSubscriptionWorkflow` via `incomingWebhook`
3. Fetches Gmail history changes and saves new emails to MongoDB (with all required fields)
4. Triggers `emailProcessingWorkflow` for any new messages
5. Matches emails against patterns, extracts transactions via OpenAI, saves results

**Bugs fixed:**

| # | Bug | Root Cause | Fix |
|---|-----|-----------|-----|
| 1 | `GmailAccount.email` saved as empty string | Missing `userinfo.email` OAuth scope — `oauth2.userinfo.get()` returned nothing silently | Added scope to `GmailProvider.getAuthUrl()`; `exchangeCode()` now throws if email is empty |
| 2 | `renewGmailWatch` activity failed with "topicName required" | `GmailProvider.linkAccount()` read `process.env.PUBSUB_TOPIC_NAME` but ConfigMap injects `GMAIL_PUBSUB_TOPIC` | Corrected env var name; added early-throw guard if topic is empty |
| 3 | `tokenExpiresAt.getTime is not a function` crash in workflow | Temporal JSON-serializes activity return values — `Date` objects become strings in transit; workflow state had a string not a Date | `tokenExpiresAt = new Date(result.expiresAt)` after every activity call |
| 4 | `invalid_grant` (token revocation) not caught by `isRevocationError` | Temporal wraps activity errors; outer `message` is `"Activity task failed"`, real error is in the `.cause` chain | `isRevocationError` now traverses the full `.cause` chain |
| 5 | Webhook routed to wrong user's workflow (multiple accounts sharing same email) | Multiple `GmailAccount` docs with same email were all `isActive: true`; `findOne` returned the oldest record | `saveGmailAccount` now calls `GmailAccount.updateMany({ email, userId: { $ne } }, { isActive: false })` before upserting |
| 6 | Non-JSON Pub/Sub test messages caused infinite webhook retry loop | Webhook handler returned `500` on JSON parse error → Pub/Sub retried indefinitely | Return `200` for non-JSON payloads and missing `emailAddress`/`historyId` fields |
| 7 | `Email validation failed: threadId required, subject required, body required, snippet required` | `getEmailsByIds` returned a stripped `SavedEmail` without required Mongoose fields; `emailProcessingWorkflow` tried to `saveEmail` with incomplete data | `getEmailsByIds` now returns all fields (`threadId`, `to`, `body`, `snippet`); workflow skips `saveEmail` entirely in the sync path (emails already saved by `fetchGmailChanges`) |
| 8 | Wrong ID used for `updateEmailProcessing` and `markEmailAsProcessed` in sync path | `getEmailsByIds` returns `id = MongoDB _id`, but those calls need the Gmail message ID | Added `const gmailMessageId = email.emailId ?? email.id` to normalize across both code paths |

**Key architectural insight — two `emailProcessingWorkflow` paths:**
```
Search path (manual trigger):
  gmailActivities.fetchEmails()  →  email.id = Gmail message ID
  saveEmail()  →  persist to MongoDB
  updateEmailProcessing(emailId: email.id)  ✅

Sync path (triggered by gmailSubscriptionWorkflow):
  emailActivities.getEmailsByIds()  →  email.id = MongoDB _id, email.emailId = Gmail message ID
  saveEmail()  →  SKIP (already saved by fetchGmailChanges with complete data)
  updateEmailProcessing(emailId: email.emailId)  ✅
```

**Files changed:**
- `packages/temporal-workflows/src/workflows/email-processing.workflow.ts` — dual-path ID normalization, skip `saveEmail` in sync path
- `packages/temporal-workflows/src/activities/database/email.activities.ts` — `getEmailsByIds` returns full fields
- `packages/temporal-workflows/src/workflows/gmail-subscription.workflow.ts` — `new Date(result.expiresAt)` fix, `isRevocationError` cause-chain traversal
- `packages/temporal-workflows/src/infrastructure/temporal/activities/sync.activities.ts` — `saveGmailAccount` deactivates duplicate email accounts
- `packages/backend-apis/src/controllers/gmail-webhook.controller.ts` — return `200` for non-Gmail Pub/Sub messages
- `packages/backend-apis/src/providers/gmail/gmail.provider.ts` — `userinfo.email` scope, `GMAIL_PUBSUB_TOPIC` env var, throw on empty email

#### 16. CI/CD — SHA-based Image Tags & Pod Restart (100%)
- ✅ Docker images now tagged `{branch}-{sha7}` (e.g. `dev-a1b2c3d`) — Kubernetes detects a real image change on every push
- ✅ `helm upgrade` sets `backend.image.tag` and `worker.image.tag` from the SHA tag
- ✅ `kubectl rollout restart` added as fallback to force pod recreation even when tag doesn't change

**File changed:** `.github/workflows/build.yml`

---

### Phase 2 Additions (March 2026)

#### 11. Provider Abstraction Layer (100%)
- ✅ `IEmailProvider` interface (`packages/backend-apis/src/providers/types.ts`)
- ✅ `GmailProvider` implementing `IEmailProvider` (`packages/backend-apis/src/providers/gmail/gmail.provider.ts`)
- ✅ Provider registry (`packages/backend-apis/src/providers/index.ts`)
- ✅ `AuthController` refactored to be provider-agnostic (accepts `IEmailProvider`)
- ✅ `GmailWebhookController` delegates `linkAccount`, `unlinkAccount`, `getAccountStatus` to provider
- ✅ Auto-link OAuth flow: `GET /api/auth/gmail?userId=<id>` embeds userId in OAuth `state`; callback auto-links on return
- ✅ Adding Outlook/Yahoo requires only: implement `IEmailProvider` + register in `providers/index.ts`

**Architecture:**
```
GET /api/auth/gmail?userId=user_123
  → GmailProvider.getAuthUrl('user_123')          # embeds userId in OAuth state (base64 JSON)
  → Google OAuth consent screen
  → GET /api/auth/gmail/callback?code=X&state=<base64>
  → AuthController decodes userId from state
  → GmailProvider.exchangeCode(code)              # gets email + refreshToken
  → GmailProvider.linkAccount({userId, email, refreshToken})  # starts Temporal workflow
  → 200 HTML: "Account linked, workflow running"
```

**Files Created/Updated:**
- `packages/backend-apis/src/providers/gmail/gmail.provider.ts` ✅ NEW
- `packages/backend-apis/src/providers/index.ts` ✅ NEW
- `packages/backend-apis/src/controllers/auth.controller.ts` ✅ REFACTORED
- `packages/backend-apis/src/controllers/gmail-webhook.controller.ts` ✅ REFACTORED
- `packages/backend-apis/src/routes/auth.routes.ts` ✅ UPDATED
- `packages/backend-apis/src/routes/gmail-webhook.routes.ts` ✅ UPDATED

#### 12. Production Infrastructure (100%)
- ✅ Kubernetes (k3s) Helm chart deployment
- ✅ NGINX Ingress for `wallet.rotbyte.com` (Cloudflare Full SSL, no TLS block needed)
- ✅ Temporal UI exposed at `temporal.rotbyte.com`
- ✅ Docker multi-arch images (linux/amd64 + linux/arm64)
- ✅ GitHub Actions CI/CD: build → push → `helm upgrade` → `kubectl rollout status`
- ✅ `HELM_VALUES_SECRETS` GitHub secret for production secrets
- ✅ Image tags: `dev` branch → `:dev` tag, main → `:latest`

#### 13. OpenAPI / Swagger Docs (100%)
- ✅ All endpoints documented with full request/response schemas
- ✅ Reusable `$ref` components (Email, Schedule, WorkflowStatus, ErrorResponse, etc.)
- ✅ Production server URL in Swagger spec
- ✅ `__dirname`-based `apis` paths (fixes Docker CWD mismatch)
- ✅ ReDoc and Scalar UI both available

#### 14. Gmail OAuth + Pub/Sub (100%)
- ✅ Redirect URI updated to `https://wallet.rotbyte.com/api/auth/gmail/callback`
- ✅ Registered in Google Cloud Console
- ✅ Auto-link on OAuth callback (no manual curl needed)

---

### 1. Project Structure (100%)
- ✅ Monorepo setup with npm workspaces
- ✅ TypeScript configuration (base + per-package)
- ✅ Package.json for all 3 packages
- ✅ .gitignore, .dockerignore, .env.example

**Files Created**:
- `package.json` (root + 3 packages)
- `tsconfig.base.json` + 3 package-specific configs
- `.gitignore`, `.dockerignore`, `.env.example`

### 2. Data Layer (100%)
- ✅ MongoDB Transaction model with indexes
- ✅ MongoDB EmailPattern model with indexes
- ✅ MongoDB Budget model with indexes
- ✅ Shared TypeScript types (workflows, activities, queries)
- ✅ Constants (task queues, retry policies, categories)

**Files Created**:
- `packages/temporal-workflows/src/models/transaction.model.ts`
- `packages/temporal-workflows/src/models/email-pattern.model.ts`
- `packages/temporal-workflows/src/models/budget.model.ts`
- `packages/temporal-workflows/src/models/index.ts`
- `packages/temporal-workflows/src/shared/types.ts`
- `packages/temporal-workflows/src/shared/constants.ts`
- `packages/temporal-workflows/src/shared/index.ts`

### 3. External API Clients (100%)
- ✅ Gmail client (OAuth2, fetch, search, label, HTML stripping)
- ✅ OpenAI client (structured extraction, validation)
- ✅ Proper error handling and logging

**Files Created**:
- `packages/temporal-workflows/src/activities/gmail/gmail-client.ts`
- `packages/temporal-workflows/src/activities/gmail/gmail.activities.ts`
- `packages/temporal-workflows/src/activities/openai/openai-client.ts`
- `packages/temporal-workflows/src/activities/openai/openai.activities.ts`

### 4. MongoDB Activities (100%)
- ✅ saveTransaction with idempotency
- ✅ matchEmailPattern with regex support
- ✅ updateEmailPatternStats with success rate calculation
- ✅ getTransactions query
- ✅ getEmailPatterns query

**Files Created**:
- `packages/temporal-workflows/src/activities/database/mongodb.activities.ts`
- `packages/temporal-workflows/src/activities/index.ts`

### 5. Temporal Workflows (100%)
- ✅ Email processing workflow with full orchestration
- ✅ Activity proxying with proper timeouts
- ✅ Retry policies (Gmail, OpenAI, MongoDB)
- ✅ Confidence threshold validation
- ✅ Error handling and logging
- ✅ Rate limiting (100ms delay between emails)

**Files Created**:
- `packages/temporal-workflows/src/workflows/email-processing.workflow.ts`
- `packages/temporal-workflows/src/workflows/index.ts`

### 6. Temporal Worker (100%)
- ✅ Worker entry point with dependency injection
- ✅ Environment configuration and validation
- ✅ Gmail OAuth2 client initialization
- ✅ OpenAI client initialization
- ✅ MongoDB connection
- ✅ Activity registration
- ✅ Graceful shutdown handling
- ✅ Comprehensive logging

**Files Created**:
- `packages/temporal-worker/src/worker.ts`
- `packages/temporal-worker/src/config/environment.ts`
- `packages/temporal-worker/src/utils/logger.ts`

### 7. Express REST API (100%)
- ✅ Server setup with middleware (helmet, cors, body-parser)
- ✅ Temporal client configuration
- ✅ Workflow controller (start, status, cancel)
- ✅ Health check routes (basic + deep)
- ✅ Error handling middleware
- ✅ Request logging
- ✅ Environment configuration

**Files Created**:
- `packages/backend-apis/src/index.ts`
- `packages/backend-apis/src/config/environment.ts`
- `packages/backend-apis/src/config/temporal-client.ts`
- `packages/backend-apis/src/controllers/workflow.controller.ts`
- `packages/backend-apis/src/routes/workflow.routes.ts`
- `packages/backend-apis/src/routes/health.routes.ts`
- `packages/backend-apis/src/routes/index.ts`
- `packages/backend-apis/src/middleware/error-handler.ts`
- `packages/backend-apis/src/utils/logger.ts`

### 8. Docker Infrastructure (100%)
- ✅ docker-compose.yml with all services:
  - PostgreSQL (Temporal's database)
  - Temporal Server
  - Temporal UI
  - MongoDB
- ✅ Health checks for all services
- ✅ Service dependencies configured
- ✅ MongoDB initialization script
- ✅ Dockerfile for Worker
- ✅ Dockerfile for API

**Files Created**:
- `docker-compose.yml`
- `scripts/mongo-init.js`
- `packages/temporal-worker/Dockerfile`
- `packages/backend-apis/Dockerfile`

### 9. Seed Data (100%)
- ✅ Chase credit card transaction pattern
- ✅ Chase debit card purchase pattern
- ✅ Chase account alert pattern
- ✅ Seed script with upsert logic

**Files Created**:
- `scripts/seed-email-patterns.ts`

### 10. Documentation (100%)
- ✅ Comprehensive README with:
  - Architecture diagram
  - Project structure
  - Getting started guide
  - Gmail OAuth setup instructions
  - API endpoint documentation
  - Monitoring guide
  - Troubleshooting section
  - Development commands
  - Roadmap

**Files Created**:
- `README.md` (completely rewritten)

---

---

## 🤖 Phase 3 — AI Extraction Pipeline (Planned)

**Goal:** Replace the current single-step AI extraction with a durable, configurable 3-step pipeline orchestrated by Temporal, routed through LiteLLM, with prompts stored in MongoDB and manageable via API/UI.

---

### AI Gateway Decision: LiteLLM ✅

**Chosen:** LiteLLM (self-hosted proxy, Docker container in k8s)

**Why LiteLLM over Bifrost:**
- Most mature and battle-tested AI proxy (production-proven at scale)
- Exposes an OpenAI-compatible REST API — the existing `OpenAIGateway` only needs its `baseURL` pointed to LiteLLM; zero code changes to the gateway implementation
- Supports every provider needed: OpenAI, Anthropic, Ollama (already in use), Groq, Gemini, and 100+ more — model switching is a config change, not a code change
- Central observability: cost tracking, token usage, logging, and fallback routing out of the box
- Bifrost is less mature and the TypeScript ecosystem around it is thinner; for a production system on k3s, LiteLLM's operational track record is more reliable

**Why not a code-level-only abstraction:**
- The project already has `IAIGateway` interface for type safety, which is kept
- But a proxy service adds: centralized routing, live model swapping without redeployment, spend caps, retry/fallback across providers, and usage dashboards — none of which are possible with a code-level interface alone

**Deployment:** LiteLLM added as a new Kubernetes `Deployment` + `Service` in the `wallet` namespace. The `OpenAIGateway`'s `baseURL` environment variable (`LITELLM_BASE_URL`) points to it. Providers and model aliases are configured in a `litellm-config.yaml` ConfigMap.

```
App → OpenAIGateway (baseURL=http://litellm-svc:4000/v1) → LiteLLM proxy → OpenAI / Ollama / Anthropic / ...
```

---

### Pipeline Architecture

Each incoming email (triggered by webhook or scheduled poll) goes through a 3-step Temporal workflow. Every step is a separate Temporal **activity**, uses its own **prompt stored in MongoDB**, and calls the AI via **LiteLLM**.

```
Webhook / Schedule
        │
        ▼
┌────────────────────────────────────────────────────────┐
│         transactionPipelineWorkflow (Temporal)         │
│                                                        │
│  Step 1: classifyEmail                                 │
│    → load prompt from DB (pipeline_steps collection)   │
│    → call LiteLLM: "Is this a bank transaction?"       │
│    → result: { isTransaction, confidence, type }       │
│    → if NOT transaction → mark ignored, stop           │
│                                                        │
│  Step 2: extractTransaction                            │
│    → load prompt from DB                               │
│    → call LiteLLM: "Extract structured transaction"    │
│    → result: { merchant, amount, currency, date,       │
│               bank, type, accountLast4, reference }    │
│                                                        │
│  Step 3: storeTransaction                              │
│    → persist to transactions collection                │
│    → link to source notification                       │
│    → update notification status → processed           │
└────────────────────────────────────────────────────────┘
```

---

### New MongoDB Collection: `pipeline_steps`

Stores the configuration for each step in the pipeline. Prompts are user-editable at runtime.

| Field | Type | Notes |
|---|---|---|
| `stepKey` | String | Unique key: `classify_email`, `extract_transaction`, `store_transaction` |
| `name` | String | Human-readable name |
| `description` | String | What this step does |
| `order` | Number | Execution order (1, 2, 3) |
| `systemPrompt` | String | The system/instruction prompt sent to the AI |
| `userPromptTemplate` | String | Template for the user message; `{{email_body}}`, `{{email_subject}}` etc. are replaced at runtime |
| `model` | String | LiteLLM model alias (e.g. `gpt-4o-mini`, `ollama/phi3`, `claude-3-haiku`) |
| `temperature` | Number | 0–1 |
| `maxTokens` | Number | Token cap |
| `isActive` | Boolean | Whether this step is enabled |
| `version` | Number | Incremented on each prompt update (for audit trail) |
| `updatedBy` | String | Who last updated the prompt |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

---

### New API Endpoints (Pipeline Management)

**Pipeline Steps (Prompt Management UI)**
```
GET    /api/pipeline/steps              — list all steps with current prompts
GET    /api/pipeline/steps/:stepKey     — get single step config
PUT    /api/pipeline/steps/:stepKey     — update prompt / model / settings
POST   /api/pipeline/steps/:stepKey/test — test a prompt against a sample email
```

**Pipeline Execution**
```
POST   /api/pipeline/run/:notificationId — manually trigger pipeline for a single notification
GET    /api/pipeline/runs               — list recent pipeline runs with status per step
```

---

### New Temporal Workflow & Activities

**Workflow:** `transactionPipelineWorkflow`
- Replaces the monolithic `emailProcessingWorkflow` extraction step
- Each step is a separate durable activity with independent retry policy
- `stepKey` is passed to each activity; activity loads prompt from DB at runtime (not hardcoded)

**Activities:**
- `classifyEmailActivity(notificationId, stepConfig)` → `ClassificationResult`
- `extractTransactionActivity(notificationId, classificationResult, stepConfig)` → `RawTransactionData`
- `storeTransactionActivity(notificationId, rawTransactionData, stepConfig)` → `Transaction`

---

### Prompt Management UI

The REST API above provides all the CRUD operations needed. The existing ReDoc/Scalar playground at `/docs/playground` is sufficient as an admin UI to read and update prompts.

For a dedicated lightweight management page, a single-file HTML form served under `/admin/pipeline` can be added to the Express API — outside the scope of the REST API proper but within the same deployment.

---

### Implemented (Phase 3 — March 25, 2026)

**Model:**
- ✅ `packages/temporal-workflows/src/models/pipeline-step.model.ts` — `pipeline_steps` collection

**Types & Constants:**
- ✅ `shared/types.ts` — `PipelineStepConfig`, `ClassifyEmailInput`, `ClassificationResult`, `ExtractTransactionDataInput`, `RawTransactionData`, `StoreTransactionInput`, `StoredTransactionResult`, `TransactionPipelineInput/Result`
- ✅ `shared/constants.ts` — `PIPELINE_STEP_KEYS`, `PIPELINE_ACTIVITY_TIMEOUTS`, `PIPELINE_RETRY_POLICY`, `CLASSIFICATION_CONFIDENCE_THRESHOLD`

**Repository:**
- ✅ `application/interfaces/repositories/ipipeline-step-repository.ts` — interface + error classes
- ✅ `infrastructure/persistence/mongodb/repositories/pipeline-step.repository.ts` — MongoDB impl

**Activities:**
- ✅ `infrastructure/temporal/activities/pipeline.activities.ts` — `classifyEmail`, `extractTransactionData`, `storeTransaction`

**Workflow:**
- ✅ `workflows/transaction-pipeline.workflow.ts` — 3-step durable pipeline workflow
- ✅ `workflows/email-processing.workflow.ts` — updated to call pipeline as child workflow

**DI / Worker:**
- ✅ `infrastructure/config/di-container.ts` — `IPipelineStepRepository` registered
- ✅ `infrastructure/temporal/activities.index.ts` — pipeline activities included
- ✅ `temporal-worker/src/config/environment.ts` — `LITELLM_BASE_URL` env var support

**API:**
- ✅ `packages/backend-apis/src/controllers/pipeline.controller.ts`
- ✅ `packages/backend-apis/src/routes/pipeline.routes.ts`
- ✅ `packages/backend-apis/src/routes/index.ts` — pipeline routes registered at `/api/pipeline`

**Infrastructure:**
- ✅ `docker-compose.yml` — LiteLLM service added (port 4000)
- ✅ `litellm-config.yaml` — LiteLLM provider configuration
- ✅ `.env.example` — `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY` added

**Seed:**
- ✅ `scripts/seed-pipeline-steps.ts` — seeds default prompts for all 3 steps
- ✅ `package.json` — `npm run seed:pipeline` script

### Remaining Infrastructure (Phase 3)

- 🔲 `k8s/mywallet/templates/litellm/` — Kubernetes manifests for LiteLLM deployment in production
- 🔲 `k8s/mywallet/values.yaml` — add LiteLLM image/resource config
- 🔲 GitHub Actions — add `LITELLM_MASTER_KEY` to `HELM_VALUES_SECRETS`

---

## 📋 Remaining Tasks

### Phase 1 - Immediate Next Steps (After Disk Space is Free)

#### 1. Install Dependencies (BLOCKED)
```bash
npm install
```
**Expected**: Install ~500MB of node_modules across all packages

#### 2. Set Up Gmail OAuth Credentials
- [ ] Create Google Cloud Project
- [ ] Enable Gmail API
- [ ] Configure OAuth consent screen
- [ ] Create OAuth 2.0 credentials (Desktop app)
- [ ] Generate refresh token
- [ ] Add credentials to `.env` file

**Create** `scripts/setup-gmail-oauth.ts` helper to automate token generation.

#### 3. Get OpenAI API Key
- [ ] Sign up at https://platform.openai.com
- [ ] Create API key
- [ ] Add to `.env` file

#### 4. Test Docker Infrastructure
```bash
docker-compose up -d
docker-compose ps
docker-compose logs -f
```
**Verify**: All services healthy (PostgreSQL, Temporal, MongoDB, Temporal UI)

#### 5. Seed Database
```bash
npm run seed:patterns
```
**Verify**: 3 Chase patterns in MongoDB

#### 6. Start Application Locally
```bash
# Terminal 1
npm run dev:worker

# Terminal 2
npm run dev:api
```
**Verify**:
- Worker connects to Temporal
- API responds on port 3000

#### 7. End-to-End Test
```bash
# Health check
curl http://localhost:3000/api/health

# Start workflow
curl -X POST http://localhost:3000/api/workflows/email-processing \
  -H "Content-Type: application/json" \
  -d '{
    "searchQuery": "from:no-reply@chase.com subject:transaction",
    "maxResults": 10,
    "afterDate": "2024-01-01"
  }'

# Get workflow status
curl http://localhost:3000/api/workflows/{workflowId}
```

#### 8. Monitor in Temporal UI
- [ ] Open http://localhost:8080
- [ ] View workflow execution
- [ ] Check activity history
- [ ] Verify success/failure handling

---

## 🔄 Phase 2 - Enhancements (Future)

### Missing Features from Phase 1

#### 1. Gmail OAuth Setup Helper Script
**File to Create**: `scripts/setup-gmail-oauth.ts`

```typescript
// Helper script to generate Gmail OAuth refresh token
// - Opens browser for user consent
// - Exchanges auth code for refresh token
// - Saves token securely
```

#### 2. Transaction Query Endpoints
**Files to Create**:
- `packages/backend-apis/src/controllers/transaction.controller.ts`
- `packages/backend-apis/src/routes/transaction.routes.ts`

**Endpoints**:
- `GET /api/transactions` - Query with filters
- `GET /api/transactions/:id` - Get single transaction
- `GET /api/transactions/stats/monthly` - Monthly statistics
- `GET /api/transactions/stats/category` - Category breakdown

#### 3. Email Pattern Management Endpoints
**Endpoints**:
- `GET /api/patterns` - List all patterns
- `POST /api/patterns` - Create new pattern
- `PUT /api/patterns/:id` - Update pattern
- `DELETE /api/patterns/:id` - Delete pattern

#### 4. Testing
**Files to Create**:
- `packages/temporal-workflows/src/__tests__/` - Unit tests for activities
- `packages/backend-apis/src/__tests__/` - API integration tests
- Jest configuration

#### 5. Additional Bank Patterns
Add patterns for:
- Bank of America
- American Express
- Wells Fargo
- Citi
- Capital One

---

## 🎯 Phase 3 - Advanced Features (Future)

### Pattern Learning (AI-Powered)
- Auto-detect new bank email formats
- Machine learning for pattern matching
- Improve extraction accuracy over time

### Budget Management
- Set category budgets
- Track spending vs budget
- Generate spending alerts
- Monthly budget reports

### Advanced Analytics
- Spending trends visualization
- Merchant categorization
- Anomaly detection (unusual transactions)
- Predictive spending forecasts

### Multi-User Support
- User authentication
- Per-user email processing
- Shared household budgets

### Notifications
- Email alerts for large transactions
- Budget overspending notifications
- Weekly/monthly summaries

---

## 📁 Project File Structure

```
mywallet/
├── .env.example                      ✅ Created
├── .gitignore                        ✅ Created
├── .dockerignore                     ✅ Created
├── package.json                      ✅ Created (root workspace)
├── tsconfig.base.json                ✅ Created
├── docker-compose.yml                ✅ Created
├── README.md                         ✅ Created (comprehensive)
├── IMPLEMENTATION_STATUS.md          ✅ This file
│
├── packages/
│   ├── backend-apis/                 ✅ Complete
│   │   ├── package.json              ✅
│   │   ├── tsconfig.json             ✅
│   │   ├── Dockerfile                ✅
│   │   └── src/
│   │       ├── index.ts              ✅
│   │       ├── config/
│   │       │   ├── environment.ts    ✅
│   │       │   └── temporal-client.ts✅
│   │       ├── routes/
│   │       │   ├── index.ts          ✅
│   │       │   ├── health.routes.ts  ✅
│   │       │   └── workflow.routes.ts✅
│   │       ├── controllers/
│   │       │   └── workflow.controller.ts ✅
│   │       ├── middleware/
│   │       │   └── error-handler.ts  ✅
│   │       └── utils/
│   │           └── logger.ts         ✅
│   │
│   ├── temporal-worker/              ✅ Complete
│   │   ├── package.json              ✅
│   │   ├── tsconfig.json             ✅
│   │   ├── Dockerfile                ✅
│   │   └── src/
│   │       ├── worker.ts             ✅
│   │       ├── config/
│   │       │   └── environment.ts    ✅
│   │       └── utils/
│   │           └── logger.ts         ✅
│   │
│   └── temporal-workflows/           ✅ Complete
│       ├── package.json              ✅
│       ├── tsconfig.json             ✅
│       └── src/
│           ├── workflows/
│           │   ├── email-processing.workflow.ts ✅
│           │   └── index.ts          ✅
│           ├── activities/
│           │   ├── gmail/
│           │   │   ├── gmail-client.ts        ✅
│           │   │   └── gmail.activities.ts    ✅
│           │   ├── openai/
│           │   │   ├── openai-client.ts       ✅
│           │   │   └── openai.activities.ts   ✅
│           │   ├── database/
│           │   │   └── mongodb.activities.ts  ✅
│           │   └── index.ts          ✅
│           ├── models/
│           │   ├── transaction.model.ts       ✅
│           │   ├── email-pattern.model.ts     ✅
│           │   ├── budget.model.ts            ✅
│           │   └── index.ts          ✅
│           └── shared/
│               ├── types.ts          ✅
│               ├── constants.ts      ✅
│               └── index.ts          ✅
│
└── scripts/
    ├── mongo-init.js                 ✅ Created
    ├── seed-email-patterns.ts        ✅ Created
    └── setup-gmail-oauth.ts          ⏳ TODO
```

**Statistics**:
- ✅ **60+ files created**
- ✅ **~3,000 lines of TypeScript**
- ✅ **100% of core functionality**
- ⏳ **1 helper script remaining**

---

## 🔧 Environment Variables Required

Copy `.env.example` to `.env` and fill in:

```env
# Node Environment
NODE_ENV=development

# API Server
PORT=3000

# Temporal Configuration
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=email-processing-queue

# MongoDB
MONGODB_URI=mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin

# Gmail API (OAuth2) - Get from Google Cloud Console
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token

# OpenAI - Get from platform.openai.com
OPENAI_API_KEY=sk-your-openai-api-key

# Logging
LOG_LEVEL=info
```

---

## 🚀 Quick Start Commands (After Disk Space Fixed)

```bash
# 1. Free disk space first!
docker system prune -a
docker volume prune

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Edit .env with your credentials

# 4. Start infrastructure
docker-compose up -d

# 5. Seed patterns
npm run seed:patterns

# 6. Start worker (Terminal 1)
npm run dev:worker

# 7. Start API (Terminal 2)
npm run dev:api

# 8. Test
curl http://localhost:3000/api/health
```

---

## 📊 Progress Summary

| Component | Status | Progress |
|-----------|--------|----------|
| Project Setup | ✅ Complete | 100% |
| Data Models | ✅ Complete | 100% |
| API Clients | ✅ Complete | 100% |
| Temporal Activities | ✅ Complete | 100% |
| Temporal Workflows | ✅ Complete | 100% |
| Worker Process | ✅ Complete | 100% |
| Express API | ✅ Complete | 100% |
| Docker / K8s Infrastructure | ✅ Complete | 100% |
| CI/CD Pipeline | ✅ Complete | 100% |
| Provider Abstraction (IEmailProvider) | ✅ Complete | 100% |
| Gmail OAuth + Pub/Sub Real-time Sync | ✅ Complete | 100% |
| Email Processing Pipeline (sync path) | ✅ Complete | 100% |
| Documentation | ✅ Complete | 100% |
| **TOTAL** | **Production — end-to-end working** | **100%** |

---

## 🐛 Known Issues

1. **Stale Temporal workflows** (`gmail-subscription-11`, `-12`, `-13`): started before the `pubSubTopicName` fix — they have an empty topic name and will keep failing. Terminate them via the Temporal UI (`https://temporal.rotbyte.com`) and re-link those accounts.

2. **No Tests**: Unit and integration tests not implemented
   - **Impact**: Manual testing only
   - **Resolution**: Add Jest tests (see Phase 3 Enhancements)

---

## 💡 Tips for Continuation

### When You Resume:

1. **First Priority**: Free disk space
2. **Second**: Run `npm install` to get dependencies
3. **Third**: Set up Gmail OAuth (see README)
4. **Fourth**: Get OpenAI API key
5. **Fifth**: Test infrastructure with `docker-compose up -d`
6. **Sixth**: Seed patterns and test end-to-end

### Testing Checklist:

- [ ] All services start successfully
- [ ] Worker connects to Temporal
- [ ] API responds to health check
- [ ] Can start email processing workflow
- [ ] Workflow executes successfully in Temporal UI
- [ ] Transactions saved to MongoDB
- [ ] Can query workflow status via API

### Monitoring:

- **Temporal UI**: http://localhost:8080
- **API Health**: http://localhost:3000/api/health
- **Worker Logs**: Check console output
- **MongoDB**: Use MongoDB Compass to view data

---

## 📞 Support Resources

- **Temporal Docs**: https://docs.temporal.io
- **Gmail API Docs**: https://developers.google.com/gmail/api
- **OpenAI Docs**: https://platform.openai.com/docs
- **MongoDB Docs**: https://docs.mongodb.com

---

**Status**: Production — Gmail sync pipeline fully operational end-to-end.
**Next**: Add user/email query endpoints, terminate stale workflows in Temporal UI.
