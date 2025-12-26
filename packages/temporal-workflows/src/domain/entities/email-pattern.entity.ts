/**
 * Domain Entity: EmailPattern
 * Layer 1 - Contains enterprise business rules
 * No dependencies on outer layers
 */
export class EmailPattern {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly bankName: string,
    public readonly fromAddresses: string[],
    public readonly subjectPatterns: string[],
    public readonly bodyKeywords: string[],
    public readonly extractionPrompt: string,
    public readonly isActive: boolean = true,
    public readonly priority: number = 0,
    public readonly accountType?: string
  ) {
    this.validate();
  }

  /**
   * Business Rule: Validate pattern invariants
   */
  private validate(): void {
    if (!this.name || this.name.trim() === '') {
      throw new Error('Pattern name is required');
    }
    if (!this.bankName || this.bankName.trim() === '') {
      throw new Error('Bank name is required');
    }
    if (this.fromAddresses.length === 0) {
      throw new Error('At least one from address is required');
    }
    if (!this.extractionPrompt || this.extractionPrompt.trim() === '') {
      throw new Error('Extraction prompt is required');
    }
  }

  /**
   * Business Rule: Check if pattern matches email
   */
  matches(emailFrom: string, emailSubject: string, emailBody: string): boolean {
    if (!this.isActive) {
      return false;
    }

    // Check from address
    const fromMatches = this.fromAddresses.some(pattern =>
      emailFrom.toLowerCase().includes(pattern.toLowerCase())
    );

    if (!fromMatches) {
      return false;
    }

    // Check subject patterns
    const subjectMatches = this.subjectPatterns.length === 0 ||
      this.subjectPatterns.some(pattern =>
        emailSubject.toLowerCase().includes(pattern.toLowerCase())
      );

    // Check body keywords
    const bodyMatches = this.bodyKeywords.length === 0 ||
      this.bodyKeywords.some(keyword =>
        emailBody.toLowerCase().includes(keyword.toLowerCase())
      );

    return subjectMatches && bodyMatches;
  }

  /**
   * Business Rule: Calculate match score (higher is better)
   */
  calculateMatchScore(emailFrom: string, emailSubject: string, emailBody: string): number {
    let score = this.priority;

    // Add points for from address match
    if (this.fromAddresses.some(pattern => emailFrom.toLowerCase() === pattern.toLowerCase())) {
      score += 10; // Exact match
    } else if (this.fromAddresses.some(pattern => emailFrom.toLowerCase().includes(pattern.toLowerCase()))) {
      score += 5; // Partial match
    }

    // Add points for subject pattern matches
    const subjectMatches = this.subjectPatterns.filter(pattern =>
      emailSubject.toLowerCase().includes(pattern.toLowerCase())
    ).length;
    score += subjectMatches * 2;

    // Add points for body keyword matches
    const bodyMatches = this.bodyKeywords.filter(keyword =>
      emailBody.toLowerCase().includes(keyword.toLowerCase())
    ).length;
    score += bodyMatches;

    return score;
  }
}
