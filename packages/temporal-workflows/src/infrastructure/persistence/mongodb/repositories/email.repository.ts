/**
 * MongoDB Email Repository (Layer 3 - Interface Adapters)
 * Implements IEmailRepository interface
 * Maps between Domain entities and Mongoose documents
 */
import { injectable, inject } from 'tsyringe';
import { Connection } from 'mongoose';
import { IEmailRepository, EmailMetadata, SavedEmail, ProcessingStatus } from '../../../../application/interfaces/repositories/iemail-repository';
import { Email } from '../../../../domain/entities/email.entity';
import { Email as EmailModel, IEmail } from '../../../../models/email.model';

@injectable()
export class MongoDBEmailRepository implements IEmailRepository {
  constructor(
    @inject('MongoConnection') private connection: Connection
  ) {}

  /**
   * Save email to MongoDB
   */
  async save(email: Email, metadata?: EmailMetadata): Promise<SavedEmail> {
    const doc = await EmailModel.create({
      emailId: email.id,
      threadId: email.threadId,
      from: email.from,
      to: email.to || '',
      subject: email.subject,
      date: email.date,
      body: email.body,
      snippet: email.snippet || '',
      isProcessed: false,
      fetchedAt: new Date(),
      fetchedBy: metadata?.fetchedBy || 'unknown',
      processingWorkflowId: metadata?.workflowId,
      matchedPatternId: metadata?.matchedPatternId,
      matchedPatternName: metadata?.matchedPatternName
    });

    return this.toSavedEmail(doc);
  }

  /**
   * Find email by ID
   */
  async findById(emailId: string): Promise<SavedEmail | null> {
    const doc = await EmailModel.findOne({ emailId });
    return doc ? this.toSavedEmail(doc) : null;
  }

  /**
   * Update processing status
   */
  async updateProcessingStatus(emailId: string, status: ProcessingStatus): Promise<void> {
    await EmailModel.updateOne(
      { emailId },
      {
        $set: {
          isProcessed: status.isProcessed,
          processedAt: status.processedAt,
          processingWorkflowId: status.workflowId,
          transactionId: status.transactionId,
          confidence: status.confidence,
          processingError: status.error
        }
      }
    );
  }

  /**
   * Mark email as processed
   */
  async markAsProcessed(emailId: string): Promise<void> {
    await EmailModel.updateOne(
      { emailId },
      {
        $set: {
          isProcessed: true,
          processedAt: new Date()
        }
      }
    );
  }

  /**
   * Find unprocessed emails
   */
  async findUnprocessed(limit?: number): Promise<SavedEmail[]> {
    const query = EmailModel.find({ isProcessed: false })
      .sort({ date: -1 });

    if (limit) {
      query.limit(limit);
    }

    const docs = await query.exec();
    return docs.map(doc => this.toSavedEmail(doc));
  }

  /**
   * Mark email as duplicate
   */
  async markDuplicate(emailId: string): Promise<void> {
    await EmailModel.updateOne(
      { emailId },
      {
        $set: {
          processingError: 'Duplicate email'
        }
      }
    );
  }

  /**
   * Check if email exists
   */
  async exists(emailId: string): Promise<boolean> {
    const count = await EmailModel.countDocuments({ emailId });
    return count > 0;
  }

  /**
   * Map Mongoose document to SavedEmail
   */
  private toSavedEmail(doc: IEmail): SavedEmail {
    return {
      id: doc._id.toString(),
      emailId: doc.emailId,
      subject: doc.subject,
      from: doc.from,
      date: doc.date,
      isProcessed: doc.isProcessed,
      processedAt: doc.processedAt,
      processingWorkflowId: doc.processingWorkflowId,
      transactionId: doc.transactionId,
      confidence: doc.confidence,
      processingError: doc.processingError
    };
  }
}
