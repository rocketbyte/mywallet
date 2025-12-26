/**
 * Domain Entity: Email
 * Layer 1 - Contains enterprise business rules
 * No dependencies on outer layers
 */
export class Email {
  constructor(
    public readonly id: string,
    public readonly from: string,
    public readonly subject: string,
    public readonly body: string,
    public readonly date: Date,
    public readonly threadId: string,
    public readonly to?: string,
    public readonly snippet?: string
  ) {
    this.validate();
  }

  /**
   * Business Rule: Validate email invariants
   */
  private validate(): void {
    if (!this.id || this.id.trim() === '') {
      throw new Error('Email ID is required');
    }
    if (!this.from || this.from.trim() === '') {
      throw new Error('Sender email is required');
    }
  }

  /**
   * Business Rule: Check if email contains specific keywords
   */
  containsKeywords(keywords: string[]): boolean {
    const searchText = `${this.subject} ${this.body}`.toLowerCase();
    return keywords.some(keyword => searchText.includes(keyword.toLowerCase()));
  }

  /**
   * Business Rule: Check if email is from specific sender
   */
  isFromSender(senderEmail: string): boolean {
    return this.from.toLowerCase().includes(senderEmail.toLowerCase());
  }

  /**
   * Business Rule: Check if email is recent (within last N days)
   */
  isRecent(days: number): boolean {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - this.date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= days;
  }

  /**
   * Business Rule: Get email age in days
   */
  getAgeInDays(): number {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - this.date.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }
}
