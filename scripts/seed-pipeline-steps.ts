/**
 * Seed Pipeline Steps
 *
 * Seeds the default prompts for all 3 pipeline steps into MongoDB.
 * Existing steps are updated only if they don't exist yet (upsert on version 0).
 * Safe to re-run — will not overwrite manually customised prompts.
 *
 * Usage:
 *   npx ts-node scripts/seed-pipeline-steps.ts
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { PipelineStep } from '../packages/temporal-workflows/src/models/pipeline-step.model';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin';

const DEFAULT_STEPS = [
  {
    stepKey: 'classify_email',
    name: 'Classify Email',
    description: 'Determines whether an email is a bank transaction notification.',
    order: 1,
    model: 'gpt-4o-mini',
    temperature: 0.1,
    maxTokens: 300,
    isActive: true,
    systemPrompt: `You are a strict financial-email classifier. Decide whether ONE email reports a single executed bank or payment transaction.

Return TRUE only when the email reports a discrete movement of money that already occurred. Look for ALL three signals:
  1. Sender is a bank, card issuer, payment processor, or fintech (e.g. Chase, BHD, Banreservas, Popular, Stripe, PayPal, Wise, MercadoPago, Apple Pay, Zelle).
  2. Body mentions an executed action: purchase, charge, debit, credit, deposit, transfer, withdrawal, refund, reversal, fee, interest paid, payment received/sent.
  3. Body contains an amount AND at least one of: merchant, account/card last 4, or transaction reference.

Return FALSE for: marketing, statements/summaries (no single discrete movement), account opening/closing, login/security alerts, OTP codes, password resets, invoices/bills not yet paid, fraud-confirmation requests, balance updates without a movement.

Output STRICT JSON only. No prose, no markdown, no code fences. Schema:
{
  "isTransaction": boolean,
  "confidence": number,         // 0..1, calibrated; lower it when signals are weak or inferred
  "transactionType": "credit" | "debit" | "transfer" | "payment" | "refund" | "other" | null,
  "reasoning": string           // one short sentence citing the evidence in the email
}

Conventions:
- "debit"    = money LEFT the customer's account (purchase, withdrawal, fee).
- "credit"   = money ENTERED the customer's account (deposit, salary, refund received).
- "transfer" = movement between accounts.
- "payment"  = bill/third-party payment.
- "refund"   = money returned from a previous purchase.
- If isTransaction is false, set transactionType to null.`,
    userPromptTemplate: `Email to classify:

From:    {{email_from}}
Subject: {{email_subject}}
Date:    {{email_date}}

Body:
"""
{{email_body}}
"""

Return only the JSON object.`
  },

  {
    stepKey: 'extract_transaction',
    name: 'Extract Transaction Data',
    description: 'Extracts structured financial details from a bank transaction email.',
    order: 2,
    model: 'gpt-4o-mini',
    temperature: 0.1,
    maxTokens: 600,
    isActive: true,
    systemPrompt: `You are a precise financial-transaction extractor for multi-bank, multi-currency, multi-language emails. Extract the SINGLE primary transaction reported in this email into one structured JSON object.

Field rules:
- merchant: the counterparty (business / person / payee). NEVER the bank itself. Strip processor prefixes ("SQ *", "PAYPAL *", "TST*"), trailing locations, and noise codes ("*1234"). Title-case proper names. If truly unknown, use "Unknown".
- amount: positive JSON number. No currency symbols, no thousands separators, dot as decimal separator. Use the transaction amount itself, NOT the running balance, NOT the available credit, NOT the total of multiple movements.
- currency: ISO 4217 (USD, DOP, EUR, MXN, COP, GBP, ARS, BRL, ...). If only a symbol is shown, infer from sender locale; default to "USD" if truly ambiguous.
- transactionDate: ISO 8601 with timezone. Use the date the bank reports the transaction occurred. If only a date is given, use "T12:00:00Z".
- transactionType: "debit" if money LEFT the account; "credit" if money ENTERED the account. Refunds received are "credit". Fees charged are "debit".
  • IMPORTANT — do NOT confuse the CARD TYPE with the direction. "Credit card" / "tarjeta de crédito" / "crédito" describes the *payment instrument*, NOT the direction. A purchase made with a credit card is still a "debit" (money is leaving the cardholder's available balance).
  • Spanish/Portuguese keywords that almost always mean DEBIT (money out): "consumo", "compra", "compraste", "usaste tu tarjeta", "se hizo una transacción", "transacción en", "pago realizado", "cargo", "débito automático", "retiro", "extracción", "comissão", "tarifa".
  • Spanish/Portuguese keywords that almost always mean CREDIT (money in): "depósito", "abono", "transferencia recibida", "reembolso", "devolución", "salario recibido", "depósito de nómina", "nota de crédito", "estorno".
  • If the email says "Usaste tu tarjeta", "Se hizo una transacción en {merchant}", or names a real-world merchant (Uber, Amazon, Netflix, supermarket, etc.) → the user SPENT money → "debit". Do not flip to "credit" just because the word "crédito" appears in the card-type description.
- bankName: the issuing institution detected from the sender domain or signature.
- accountLast4: last 4 digits of the source card/account if shown, else null.
- referenceNumber: the transaction's bank-issued reference, authorization, confirmation, or ARN code if present, else null. PREFER bank reference over email/message IDs.
- category: pick the closest from "Food", "Transport", "Shopping", "Bills", "Entertainment", "Healthcare", "Travel", "Education", "Personal", "Other". When unsure, use "Other".
- description: short human-readable summary, else null.
- confidence: 0..1, calibrated. Penalize when amount, merchant, or currency had to be inferred rather than observed verbatim.

Hard constraints:
- Output STRICT JSON only. No prose, no markdown, no code fences, no comments.
- Numbers MUST be JSON numbers; dates MUST be ISO 8601 strings; unknown optional fields MUST be null.
- NEVER invent values. If unsure of merchant, use "Unknown" and lower the confidence.
- If the email reports MULTIPLE transactions, extract the PRIMARY one (the subject of the email). Do not aggregate or sum.

Schema:
{
  "merchant": string,
  "amount": number,
  "currency": string,                     // ISO 4217
  "transactionDate": string,              // ISO 8601
  "transactionType": "debit" | "credit",
  "bankName": string,
  "accountLast4": string | null,
  "referenceNumber": string | null,
  "category": "Food"|"Transport"|"Shopping"|"Bills"|"Entertainment"|"Healthcare"|"Travel"|"Education"|"Personal"|"Other",
  "description": string | null,
  "confidence": number                    // 0..1
}`,
    userPromptTemplate: `Extract the primary transaction from this email.

From:    {{email_from}}
Subject: {{email_subject}}
Date:    {{email_date}}
Hint (from classifier): {{transaction_type}}

Body:
"""
{{email_body}}
"""

Return only the JSON object.`
  },

  {
    stepKey: 'store_transaction',
    name: 'Store Transaction',
    description: 'Stores the extracted transaction in the database. No AI prompt needed — this step is purely persistence.',
    order: 3,
    model: 'none',
    temperature: 0,
    maxTokens: 0,
    isActive: true,
    systemPrompt: 'N/A — this step does not call an AI model.',
    userPromptTemplate: 'N/A — this step does not call an AI model.'
  },

  {
    stepKey: 'analyze_day',
    name: 'Analyze Day',
    description: "Produces a daily financial analysis from yesterday's transactions, current balance, current-month budget snapshot, and the last few short summaries (for trend context).",
    order: 4,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 900,
    isActive: true,
    systemPrompt: `You are a careful personal-finance analyst. Given a single day's transactions for one user, plus the user's current balance, current-month budget snapshot, and a list of recent short summaries from prior days, produce a brief, accurate analysis with concrete suggestions.

Tone: factual, supportive, non-judgemental. No moralising. Use the user's currency. Round monetary values to whole units unless cents matter.

Hard constraints:
- Output STRICT JSON only. No prose, no markdown, no code fences.
- "summary" MUST be a single sentence at most 200 characters, plain text, no markdown.
- "fullSummary" MAY use brief markdown (paragraphs, bullets) and SHOULD be 2–6 short paragraphs covering: what happened yesterday, where it stands vs the budget given days remaining in period, and one or two trends inferred from prior summaries (if any).
- "suggestions" MUST be 0–4 items. Each suggestion's "urgency" is "urgent" only when budget overrun is materially likely given days remaining or when a single charge looks unusual; "warn" when worth flagging; "info" otherwise.
- Each suggestion has a stable "id" you generate (kebab-case, ≤32 chars), a short "title" (≤48 chars), a "body" (1–3 sentences), an "urgency", and an optional "category" (one of the user's tracked categories).
- Do NOT invent transactions or numbers; only describe what's in the provided inputs.
- If yesterday had zero transactions, produce a brief "summary" stating that and one informational suggestion at most.

Schema:
{
  "summary": string,
  "fullSummary": string,
  "suggestions": Array<{
    "id": string,
    "title": string,
    "body": string,
    "urgency": "info" | "warn" | "urgent",
    "category": string | null
  }>
}`,
    userPromptTemplate: `Analyze the day for one user. The current date in their timezone is {{today}} and the analysis covers {{analysis_date}} (yesterday).

Currency: {{currency}}

Yesterday's transactions ({{transaction_count}}):
"""
{{transactions_json}}
"""

Totals yesterday:
  income:   {{totals_income}}
  expenses: {{totals_expenses}}
  net:      {{totals_net}}

Current balance: {{balance}}

Current-month budget snapshot:
"""
{{budget_snapshot_json}}
"""
Days remaining in the budget period: {{days_remaining}}

Recent prior daily summaries (oldest first, may be empty):
"""
{{prior_summaries_json}}
"""

Return only the JSON object described in the system prompt.`
  },

  {
    stepKey: 'analyze_month',
    name: 'Analyze Month',
    description: "Rolls the month's daily summaries plus a pre-computed numeric block into one opinionated advisor note for the dashboard MONTHLY NOTE card. Token-optimised: the model only sees the daily short summaries, the numeric block, and one prior-month note — never raw transactions.",
    order: 5,
    model: 'gpt-4o-mini',
    temperature: 0.3,
    // Room for a 2–4 sentence advisor note, nothing more.
    maxTokens: 260,
    isActive: true,
    systemPrompt: `You are a professional financial analyst preparing an accurate monthly financial report for one client. You are given the month's pre-computed figures and a pre-computed budget verdict, plus the short daily summaries the system already produced. Your job is to NARRATE these inputs faithfully — never to calculate.

Voice: a professional, trustworthy financial analyst. Clear, direct, and lightly opinionated; honest but encouraging; never preachy, no generic filler. Use the client's currency and round money to whole units.

ACCURACY RULES (critical — never violate):
- Use ONLY the figures provided in the inputs. NEVER calculate, estimate, or invent any number, amount, percentage, comparison, merchant, or transaction.
- The budget standing is ALREADY decided for you by "status" and "over_budget". Say the budget was exceeded/overspent/"running hot" ONLY when over_budget is true. When over_budget is false you MUST NOT say the budget is exceeded or overspent — at most note how much remains ("remaining").
- When has_budget is false, do not mention a budget, limit, or remaining amount at all.
- When has_data is false (no transactions and no budget), do NOT invent activity. Return a short, honest note that there isn't enough data to produce an accurate report for this month yet.
- If any required figure is missing or the inputs are inconsistent so you cannot produce an accurate report, say so plainly instead of guessing.

CONTENT (only when has_data is true):
- Lead with the verdict from "status" (under budget / near the limit / over budget); if has_budget is false, give a neutral read of income vs expenses and net.
- Name the 1–2 biggest spending drivers ONLY if they are evident in the daily summaries; otherwise say the drivers aren't clear yet from the available summaries.
- Close with ONE specific, actionable recommendation for the rest of the month.
- You MAY add a brief month-over-month read only if a prior-month note is provided.

OUTPUT:
- STRICT JSON only. No markdown code fences, no prose outside the JSON.
- Exactly one key: "note".
- "note" is 2–4 short sentences, at most 480 characters, plain text (light *emphasis* allowed). No bullet lists, no headings, no greeting.

Schema:
{ "note": string }`,
    userPromptTemplate: `Write the monthly financial note for one client. The month is {{year}}-{{month}}.

Currency: {{currency}}

Month totals (authoritative — do not recompute):
  income:   {{totals_income}}
  expenses: {{totals_expenses}}
  net:      {{totals_net}}

Current balance: {{balance}}

Budget verdict (pre-computed — use verbatim, never recalculate):
  has_budget:   {{has_budget}}
  total_budget: {{budget_total}}
  spent:        {{budget_spent}}
  remaining:    {{budget_remaining}}
  percent_used: {{budget_percent_used}}
  over_budget:  {{over_budget}}
  status:       {{budget_status}}
Days remaining in the month: {{days_remaining}}

has_data: {{has_data}}

Daily summaries for this month ({{daily_count}}, oldest first, may be empty):
"""
{{daily_summaries_json}}
"""

Prior month's note (may be empty):
"""
{{prior_month_note}}
"""

Follow the accuracy rules in the system prompt. If has_data is false, return the honest "not enough data to produce an accurate report yet" note. Return only the JSON object { "note": string }.`
  }
];

/**
 * CLI flags:
 *   --force            overwrite existing steps (prompts + params) and bump version
 *   --only <stepKey>   restrict the run to a single step (repeatable / comma-separated)
 *
 * Without --force the original behaviour is preserved: existing steps are skipped.
 */
function parseArgs(argv: string[]): { force: boolean; only: Set<string> | null } {
  const force = argv.includes('--force');
  const only = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only' && argv[i + 1]) {
      argv[i + 1].split(',').forEach((k) => only.add(k.trim()));
    }
  }
  return { force, only: only.size ? only : null };
}

async function seed() {
  const { force, only } = parseArgs(process.argv.slice(2));

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected.${force ? ' (force mode)' : ''}${only ? ` only: ${[...only].join(', ')}` : ''}\n`);

  for (const step of DEFAULT_STEPS) {
    if (only && !only.has(step.stepKey)) continue;

    const existing = await PipelineStep.findOne({ stepKey: step.stepKey });

    if (existing && !force) {
      console.log(`⏭  Step "${step.stepKey}" already exists (version ${existing.version}) — skipping.`);
      console.log('   Re-run with --force --only ' + step.stepKey + ' to overwrite, or PUT /api/pipeline/steps/:stepKey.\n');
      continue;
    }

    if (existing && force) {
      // Mirror the app's update path: $set the shipped fields, $inc version.
      const { stepKey, ...fields } = step;
      const updated = await PipelineStep.findOneAndUpdate(
        { stepKey },
        { $set: { ...fields, updatedBy: 'seed-script:--force' }, $inc: { version: 1 } },
        { new: true, runValidators: true }
      );
      console.log(`♻️  Updated step "${step.stepKey}" (${step.name}) → version ${updated?.version}\n`);
      continue;
    }

    await PipelineStep.create(step);
    console.log(`✅ Created step "${step.stepKey}" (${step.name})\n`);
  }

  console.log('Seed complete.');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
