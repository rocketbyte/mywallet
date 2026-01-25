# PROJECT.md — MyWallet

## 1. Overview

**Project Name:** MyWallet

**Purpose:**
MyWallet is an automated, backend-first expense tracking and financial intelligence system designed to ingest bank transaction emails from multiple email providers and transform unstructured email content into structured, queryable financial data. The system continuously monitors incoming emails using both event-driven mechanisms (webhooks) and scheduled querying to ensure reliable, timely, and resilient ingestion of transaction-related messages across different providers and delivery models.

After ingestion, MyWallet processes email content through AI-driven extraction pipelines to identify, normalize, and validate transaction attributes such as amounts, dates, merchants, currencies, and transaction direction (income or expense). Extracted data is deduplicated, persisted, and associated with the appropriate tenant, forming a durable and auditable record of financial activity. The extraction layer is designed to be extensible, allowing support for multiple email formats, banks, and AI vendors without requiring changes to the core orchestration logic.

Beyond raw data extraction, MyWallet performs higher-level financial analysis by aggregating transactions over configurable time ranges (e.g., monthly, quarterly, or custom periods). AI-powered analysis processes calculate income and expenses, derive balances, evaluate spending patterns, and compare results against configured budgets. Based on these analyses, the system can generate alerts when spending approaches or exceeds defined thresholds and surface insights and recommendations intended to help users better understand and manage their finances.

The platform is designed as a multi-tenant system supporting multiple users with fully isolated data, credentials, configurations, and analysis results. Each tenant may connect one or more email accounts, configure extraction patterns and schedules, define budgets, and select preferred AI or email providers. Strong tenant isolation ensures data security while allowing the system to scale across individuals or organizations.

MyWallet exposes a comprehensive, vendor-agnostic REST API that enables integration with any external frontend or client application. Through this API, consumers can manage tenants, configure ingestion sources and schedules, query transactions and analyses, retrieve alerts and insights, and update budgets and preferences. MyWallet itself does not provide a user interface and makes no assumptions about presentation or visualization, functioning strictly as a backend financial intelligence platform.

To ensure long-term reliability, correctness, and fault tolerance, all asynchronous and side-effecting operations are orchestrated using Temporal workflows. Temporal provides durable execution, deterministic retries, and resilience to partial failures across external integrations such as email providers, AI services, and databases, allowing MyWallet to operate continuously and recover gracefully without data loss.

---

## 2. Goals & Success Criteria

### Primary Goals

* Reliably ingest and process financial transaction emails without data loss
* Ensure each eligible email is processed at most once per tenant
* Extract accurate, structured transaction data from unstructured email content
* Provide reliable financial aggregation, analysis, and budgeting capabilities
* Expose a stable, well-defined API for integration with external clients

### Non-Goals

* Providing a built-in graphical user interface
* Offering financial advice or regulatory compliance guarantees
* Real-time processing guarantees beyond best-effort delivery

### Definition of Done

The project is considered complete when:

* All functional requirements in this document are implemented
* All workflows execute durably and deterministically via Temporal
* Tenant isolation is enforced across all data and operations
* Budget evaluation and alerting function correctly for configured tenants
* No required feature is partially implemented

---

## 3. Functional Requirements

### 3.1 Multi-Tenancy

* The system MUST support multiple tenants with strict data isolation.
* Each tenant MUST have independent configuration, credentials, budgets, and data.
* All API requests MUST be scoped to a specific tenant.

### 3.2 Email Provider Integration

* The system MUST integrate with Gmail using OAuth 2.0 credentials.
* The system MUST support scheduled polling and webhook-based ingestion.
* The system SHOULD be designed to support additional email providers (e.g., Outlook).
* Each email message MUST be uniquely identified and deduplicated per tenant.

### 3.3 Email Processing Workflows

* All email processing MUST be orchestrated using Temporal workflows.
* A workflow MUST:

  1. Retrieve matching emails for a tenant
  2. Persist raw email metadata and content
  3. Match emails against configured extraction patterns
  4. Invoke AI extraction for transaction data
  5. Persist extracted transactions
* Workflow retries and error handling MUST be managed by Temporal.

### 3.4 AI-Based Transaction Extraction

* The system MUST use AI services to extract structured transaction data.
* Extraction MUST be prompt-driven and reproducible per request.
* The system MUST support pluggable AI providers.
* The system MUST NOT perform autonomous model training.

### 3.5 Financial Analysis & Budgeting

* The system MUST aggregate transactions over configurable time ranges.
* The system MUST calculate income, expenses, and balances per tenant.
* The system MUST allow tenants to define budgets by category or period.
* The system MUST evaluate spending against budgets.
* The system MUST generate alerts when budget thresholds are approached or exceeded.

### 3.6 Scheduling

* The system MUST allow tenants to create, update, pause, and delete schedules.
* Schedules MUST trigger Temporal workflows using cron expressions.

### 3.7 REST API

* The system MUST expose HTTP endpoints to:

  * Manage tenants and configurations
  * Manage email connections and schedules
  * Trigger and inspect workflows
  * Query emails, transactions, analyses, budgets, and alerts
* APIs MUST return structured JSON responses and meaningful error codes.

---

## 4. User Flows

### Email Ingestion and Analysis Flow

1. A tenant configures an email account, patterns, and schedules.
2. Incoming emails are detected via webhook or polling.
3. Temporal workflows process new emails.
4. Transactions are extracted and stored.
5. Financial aggregates are updated.
6. Budgets are evaluated and alerts generated if necessary.

---

## 5. System Behavior & Rules

* Each email message MUST be processed at most once per tenant.
* Duplicate messages MUST be ignored deterministically.
* Tenant data MUST never be accessible across tenant boundaries.
* External failures MUST NOT corrupt persisted data.
* OAuth tokens MUST be refreshed automatically when expired.

---

## 6. Data Model

### Core Entities

**Tenant**

* tenantId (unique)
* configuration

**Email**

* tenantId
* providerMessageId (unique per tenant)
* headers
* body
* processedAt

**Transaction**

* tenantId
* amount
* merchant
* date
* category
* direction (income | expense)
* sourceEmailId

**Budget**

* tenantId
* period
* limits

**Alert**

* tenantId
* type
* threshold
* triggeredAt

**Schedule**

* tenantId
* name
* searchQuery
* cronExpression
* status

**Pattern**

* tenantId
* bankName
* matching rules
* extraction prompt

---

## 7. Architecture Constraints

* Temporal MUST be used for all workflow orchestration.
* External side effects MUST be implemented as Temporal activities.
* MongoDB MUST be used for persistent storage.
* The REST API layer MUST be implemented using Express or equivalent.
* Alternative orchestration or persistence technologies are out of scope.

---

## 8. Error Handling & Edge Cases

* Transient failures MUST be retried automatically by Temporal.
* Permanent failures MUST be recorded and exposed via APIs.
* Invalid tenant or configuration inputs MUST be rejected deterministically.

---

## 9. Non-Functional Requirements

* Workflows MUST be durable and replayable.
* The system MUST tolerate restarts without data loss.
* Tenant isolation MUST be enforced at all layers.
* No strict real-time latency guarantees are required.

---

## 10. Change Policy

* Any change MUST directly support completing the requirements in this document.
* Enhancements not required for correctness or defined functionality are out of scope.
* This document is the single source of truth for system behavior and scope.

---

*If a behavior or feature is not explicitly described in this document, it is considered out of scope.*
