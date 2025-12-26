/**
 * MongoDB Pattern Repository (Layer 3 - Interface Adapters)
 * Implements IPatternRepository interface
 * Maps between Domain entities and Mongoose documents
 */
import { injectable, inject } from 'tsyringe';
import { Connection } from 'mongoose';
import { IPatternRepository } from '../../../../application/interfaces/repositories/ipattern-repository';
import { Email } from '../../../../domain/entities/email.entity';
import { EmailPattern } from '../../../../domain/entities/email-pattern.entity';
import { EmailPattern as EmailPatternModel, IEmailPattern } from '../../../../models/email-pattern.model';

@injectable()
export class MongoDBPatternRepository implements IPatternRepository {
  constructor(
    @inject('MongoConnection') private connection: Connection
  ) {}

  /**
   * Find pattern matching an email
   * Returns the best matching pattern based on priority and match score
   */
  async findMatchingPattern(email: Email): Promise<EmailPattern | null> {
    // Get all active patterns
    const patterns = await this.findAllActive();

    if (patterns.length === 0) {
      return null;
    }

    // Find patterns that match and calculate scores
    const matches = patterns
      .map(pattern => ({
        pattern,
        score: pattern.calculateMatchScore(email.from, email.subject, email.body)
      }))
      .filter(m => m.score > 0)
      .filter(m => m.pattern.matches(email.from, email.subject, email.body));

    if (matches.length === 0) {
      return null;
    }

    // Sort by score (highest first) and return best match
    matches.sort((a, b) => b.score - a.score);
    return matches[0].pattern;
  }

  /**
   * Find pattern by ID
   */
  async findById(patternId: string): Promise<EmailPattern | null> {
    const doc = await EmailPatternModel.findById(patternId);
    return doc ? this.toDomain(doc) : null;
  }

  /**
   * Find all active patterns
   */
  async findAllActive(): Promise<EmailPattern[]> {
    const docs = await EmailPatternModel.find({ isActive: true }).sort({ priority: -1 });
    return docs.map(doc => this.toDomain(doc));
  }

  /**
   * Find all patterns (active and inactive)
   */
  async findAll(): Promise<EmailPattern[]> {
    const docs = await EmailPatternModel.find().sort({ priority: -1 });
    return docs.map(doc => this.toDomain(doc));
  }

  /**
   * Update pattern statistics after processing
   */
  async updatePatternStats(patternId: string, success: boolean): Promise<void> {
    await EmailPatternModel.updateOne(
      { _id: patternId },
      {
        $inc: {
          matchCount: 1,
          ...(success ? {} : { failCount: 1 })
        },
        $set: {
          lastMatchedAt: new Date()
        }
      }
    );
  }

  /**
   * Save or update a pattern
   */
  async save(pattern: EmailPattern): Promise<EmailPattern> {
    const doc = await EmailPatternModel.findByIdAndUpdate(
      pattern.id,
      {
        name: pattern.name,
        bankName: pattern.bankName,
        fromAddresses: pattern.fromAddresses,
        subjectPatterns: pattern.subjectPatterns,
        bodyKeywords: pattern.bodyKeywords,
        extractionPrompt: pattern.extractionPrompt,
        isActive: pattern.isActive,
        priority: pattern.priority,
        accountType: pattern.accountType
      },
      { new: true, upsert: true }
    );

    return this.toDomain(doc!);
  }

  /**
   * Map Mongoose document to Domain entity
   */
  private toDomain(doc: IEmailPattern): EmailPattern {
    return new EmailPattern(
      doc._id.toString(),
      doc.name,
      doc.bankName,
      doc.fromAddresses,
      doc.subjectPatterns,
      doc.bodyKeywords,
      doc.extractionPrompt,
      doc.isActive,
      doc.priority,
      doc.accountType
    );
  }
}
