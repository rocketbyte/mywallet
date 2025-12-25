#!/usr/bin/env tsx

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { EmailPattern } from '../packages/temporal-workflows/src/models';

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin';

const chasePatterns = [
  {
    name: 'Chase Credit Card Transaction',
    bankName: 'Chase',
    accountType: 'credit' as const,
    fromAddresses: [
      'no-reply@chase.com',
      'no-reply@alertsp.chase.com'
    ],
    subjectPatterns: [
      'Your \\$[0-9,.]+ transaction',
      'Chase Credit Card transaction',
      'Your.*purchase.*approved'
    ],
    bodyKeywords: [
      'transaction',
      'merchant',
      'card ending in',
      'purchase'
    ],
    extractionPrompt: `Extract the following information from this Chase credit card transaction email:
- Transaction amount (remove $ sign and convert to number)
- Merchant name (the business where the transaction occurred)
- Transaction date (convert to ISO date format)
- Last 4 digits of the card number
- Categorize the transaction based on the merchant type (Food, Transport, Shopping, Bills, Entertainment, Healthcare, Travel, Education, Personal, Other)

Return the data as JSON with fields: transactionDate, merchant, amount, currency (default to USD), category, transactionType (set to "credit" for credit card), accountNumber, confidence (0-1 score).`,
    isActive: true,
    priority: 10
  },
  {
    name: 'Chase Debit Card Purchase',
    bankName: 'Chase',
    accountType: 'debit' as const,
    fromAddresses: [
      'no-reply@chase.com',
      'no-reply@alerts.chase.com'
    ],
    subjectPatterns: [
      'Your \\$[0-9,.]+ debit card purchase',
      'Chase checking account transaction',
      'Debit card purchase'
    ],
    bodyKeywords: [
      'debit card',
      'purchase',
      'checking account',
      'account ending in'
    ],
    extractionPrompt: `Extract the following information from this Chase debit card purchase email:
- Purchase amount (remove $ sign and convert to number)
- Merchant name
- Transaction date (convert to ISO date format)
- Last 4 digits of the account number
- Categorize based on merchant type (Food, Transport, Shopping, Bills, Entertainment, Healthcare, Travel, Education, Personal, Other)

Return JSON with: transactionDate, merchant, amount, currency (USD), category, transactionType (set to "debit"), accountNumber, confidence.`,
    isActive: true,
    priority: 9
  },
  {
    name: 'Chase Account Alert',
    bankName: 'Chase',
    accountType: 'checking' as const,
    fromAddresses: [
      'no-reply@chase.com'
    ],
    subjectPatterns: [
      'Your Chase account',
      'Account alert',
      'Low balance alert'
    ],
    bodyKeywords: [
      'account',
      'balance',
      'transaction',
      'withdrawal',
      'deposit'
    ],
    extractionPrompt: `Extract transaction information from this Chase account alert:
- Transaction amount
- Transaction type (withdrawal/deposit)
- Transaction date
- Merchant or source (if available)
- Account number (last 4 digits)
- Categorize appropriately

Return JSON with: transactionDate, merchant, amount, currency, category, transactionType ("debit" for withdrawal, "credit" for deposit), accountNumber, confidence.`,
    isActive: true,
    priority: 8
  }
];

async function seedEmailPatterns() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    console.log('\nSeeding Chase email patterns...');

    for (const pattern of chasePatterns) {
      try {
        // Use upsert to avoid duplicates
        const result = await EmailPattern.findOneAndUpdate(
          { name: pattern.name },
          pattern,
          { upsert: true, new: true }
        );

        console.log(`✅ ${pattern.name} - ${result._id}`);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`❌ Failed to seed ${pattern.name}: ${error.message}`);
        }
      }
    }

    console.log('\n✨ Email patterns seeded successfully!');

    // Display summary
    const totalPatterns = await EmailPattern.countDocuments();
    const activePatterns = await EmailPattern.countDocuments({ isActive: true });
    console.log(`\nTotal patterns: ${totalPatterns}`);
    console.log(`Active patterns: ${activePatterns}`);

  } catch (error) {
    console.error('Error seeding email patterns:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run the seed script
seedEmailPatterns();
