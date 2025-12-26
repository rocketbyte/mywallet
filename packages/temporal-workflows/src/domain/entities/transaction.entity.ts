/**
 * Domain Entity: Transaction
 * Layer 1 - Contains enterprise business rules
 * No dependencies on outer layers
 */
export class Transaction {
  constructor(
    public readonly id: string,
    public readonly emailId: string,
    public readonly transactionDate: Date,
    public readonly merchant: string,
    public readonly amount: number,
    public readonly currency: string,
    public readonly category: string,
    public readonly transactionType: 'debit' | 'credit',
    public readonly accountNumber: string,
    public readonly confidence: number,
    public readonly bankName?: string,
    public readonly subcategory?: string,
    public readonly rawData?: any
  ) {
    this.validate();
  }

  /**
   * Business Rule: Validate transaction invariants
   */
  private validate(): void {
    if (this.confidence < 0 || this.confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
    if (this.amount < 0) {
      throw new Error('Amount cannot be negative');
    }
    if (!this.merchant || this.merchant.trim() === '') {
      throw new Error('Merchant is required');
    }
  }

  /**
   * Business Rule: High confidence threshold
   */
  isHighConfidence(): boolean {
    return this.confidence >= 0.7;
  }

  /**
   * Business Rule: Check transaction type
   */
  isDebit(): boolean {
    return this.transactionType === 'debit';
  }

  isCredit(): boolean {
    return this.transactionType === 'credit';
  }

  /**
   * Business Rule: Format amount with currency
   */
  getFormattedAmount(): string {
    return `${this.currency} ${this.amount.toFixed(2)}`;
  }

  /**
   * Business Rule: Check if transaction is above threshold
   */
  isAboveThreshold(threshold: number): boolean {
    return this.amount >= threshold;
  }
}
