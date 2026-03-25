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
    systemPrompt: `You are a financial email classifier. Your job is to determine whether an email is a bank transaction notification.

A bank transaction email typically:
- Comes from a bank or financial institution
- Contains information about a debit, credit, transfer, payment, purchase, or refund
- Mentions an amount, a merchant, or an account

Respond ONLY with a valid JSON object in this exact format:
{
  "isTransaction": true or false,
  "confidence": 0.0 to 1.0,
  "transactionType": "credit" | "debit" | "transfer" | "payment" | "refund" | "other" | null,
  "reasoning": "brief explanation"
}`,
    userPromptTemplate: `Classify this email:

From: {{email_from}}
Subject: {{email_subject}}
Date: {{email_date}}

Body:
{{email_body}}`
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
    systemPrompt: `You are a financial data extractor. Extract structured transaction information from bank notification emails.

Rules:
- Extract the exact amount as a number (no currency symbols, no commas)
- Use ISO 4217 currency codes (USD, DOP, EUR, etc.)
- Merchant should be the business name, not the bank name
- transactionDate should be in ISO 8601 format
- transactionType must be "debit" or "credit"
- confidence is your confidence in the extraction from 0.0 to 1.0
- If a field cannot be determined, use null

Respond ONLY with a valid JSON object in this exact format:
{
  "merchant": "merchant name",
  "amount": 123.45,
  "currency": "USD",
  "transactionDate": "2026-03-25T10:00:00Z",
  "transactionType": "debit" or "credit",
  "bankName": "bank name",
  "accountLast4": "1234" or null,
  "referenceNumber": "ref number" or null,
  "category": "Food" | "Transport" | "Shopping" | "Bills" | "Entertainment" | "Healthcare" | "Travel" | "Education" | "Personal" | "Other",
  "description": "brief description" or null,
  "confidence": 0.0 to 1.0
}`,
    userPromptTemplate: `Extract transaction data from this email:

From: {{email_from}}
Subject: {{email_subject}}
Date: {{email_date}}
Transaction type hint: {{transaction_type}}

Body:
{{email_body}}`
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
  }
];

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.\n');

  for (const step of DEFAULT_STEPS) {
    const existing = await PipelineStep.findOne({ stepKey: step.stepKey });

    if (existing) {
      console.log(`⏭  Step "${step.stepKey}" already exists (version ${existing.version}) — skipping.`);
      console.log('   Use PUT /api/pipeline/steps/:stepKey to update prompts.\n');
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
