import { Context } from '@temporalio/activity';
import { OpenAIClient } from './openai-client';
import { ExtractTransactionInput, ExtractedTransaction } from '../../shared/types';

export const createOpenAIActivities = (openaiClient: OpenAIClient) => {
  return {
    /**
     * Extract transaction data from email content using OpenAI
     */
    async extractTransactionFromEmail(
      input: ExtractTransactionInput
    ): Promise<ExtractedTransaction> {
      Context.current().heartbeat();

      const systemPrompt = `You are a transaction data extractor. Extract structured transaction information from bank notification emails.

Return a JSON object with the following structure:
{
  "transactionDate": "ISO date string",
  "merchant": "merchant name",
  "amount": number (positive value, no currency symbols),
  "currency": "USD" or other currency code,
  "category": "one of: Food, Transport, Shopping, Bills, Entertainment, Healthcare, Travel, Education, Personal, Other",
  "transactionType": "debit" or "credit",
  "accountNumber": "last 4 digits or masked account number",
  "confidence": number between 0 and 1 indicating extraction confidence
}

Important:
- Extract the exact transaction amount as a number
- Determine the appropriate category based on the merchant type
- Set confidence based on how clear the information is in the email
- If any information is unclear or missing, lower the confidence score`;

      const userPrompt = `Bank: ${input.bankName}
Email From: ${input.emailFrom}
Email Subject: ${input.emailSubject}
Email Date: ${input.emailDate}

Email Content:
${input.emailContent}

Additional extraction instructions:
${input.extractionPrompt}

Extract the transaction details as JSON:`;

      console.log('Extracting transaction data with OpenAI...');

      try {
        const extractedData = await openaiClient.extractStructuredData(
          systemPrompt,
          userPrompt
        );

        // Validate the extracted data
        if (!openaiClient.validateTransactionData(extractedData)) {
          throw new Error('Extracted data validation failed');
        }

        console.log('Transaction extracted successfully:', {
          merchant: extractedData.merchant,
          amount: extractedData.amount,
          confidence: extractedData.confidence
        });

        return {
          transactionDate: new Date(extractedData.transactionDate),
          merchant: extractedData.merchant,
          amount: extractedData.amount,
          currency: extractedData.currency || 'USD',
          category: extractedData.category,
          transactionType: extractedData.transactionType,
          accountNumber: extractedData.accountNumber,
          confidence: extractedData.confidence || 0.8,
          rawResponse: extractedData
        };
      } catch (error) {
        console.error('OpenAI extraction failed:', error);
        throw error;
      }
    }
  };
};

export type OpenAIActivities = ReturnType<typeof createOpenAIActivities>;
