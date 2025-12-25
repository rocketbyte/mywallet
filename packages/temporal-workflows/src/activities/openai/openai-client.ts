import OpenAI from 'openai';

export class OpenAIClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Extract structured data from text using GPT with JSON mode
   */
  async extractStructuredData(systemPrompt: string, userPrompt: string): Promise<any> {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini', // Cost-effective for structured extraction
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1, // Low temperature for consistency
      max_tokens: 500
    });

    const content = completion.choices[0].message.content;
    return content ? JSON.parse(content) : {};
  }

  /**
   * Validate extracted transaction data
   */
  validateTransactionData(data: any): boolean {
    const requiredFields = [
      'transactionDate',
      'merchant',
      'amount',
      'currency',
      'category',
      'transactionType',
      'accountNumber'
    ];

    for (const field of requiredFields) {
      if (!(field in data)) {
        console.warn(`Missing required field: ${field}`);
        return false;
      }
    }

    // Validate amount is a number
    if (typeof data.amount !== 'number' || isNaN(data.amount)) {
      console.warn('Invalid amount:', data.amount);
      return false;
    }

    // Validate transaction type
    if (!['debit', 'credit'].includes(data.transactionType)) {
      console.warn('Invalid transaction type:', data.transactionType);
      return false;
    }

    return true;
  }
}
