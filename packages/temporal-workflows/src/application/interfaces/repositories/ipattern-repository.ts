/**
 * Pattern Repository Interface (Layer 2 - Application)
 * Defines contract for email pattern persistence
 * Follows Dependency Inversion Principle
 */
import { Email } from '../../../domain/entities/email.entity';
import { EmailPattern } from '../../../domain/entities/email-pattern.entity';

export interface IPatternRepository {
  /**
   * Find pattern matching an email
   * Returns the best matching pattern based on priority and match score
   */
  findMatchingPattern(email: Email): Promise<EmailPattern | null>;

  /**
   * Find pattern by ID
   */
  findById(patternId: string): Promise<EmailPattern | null>;

  /**
   * Find all active patterns
   */
  findAllActive(): Promise<EmailPattern[]>;

  /**
   * Find all patterns (active and inactive)
   */
  findAll(): Promise<EmailPattern[]>;

  /**
   * Update pattern statistics after processing
   */
  updatePatternStats(patternId: string, success: boolean): Promise<void>;

  /**
   * Save or update a pattern
   */
  save(pattern: EmailPattern): Promise<EmailPattern>;
}

export interface PatternMatchResult {
  pattern: EmailPattern;
  score: number;
}
