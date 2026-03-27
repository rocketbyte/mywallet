/**
 * Prisma Email Repository (Layer 3 - Interface Adapters)
 * Implements IEmailRepository — drop-in replacement for MongoDBEmailRepository.
 */
import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import {
  IEmailRepository,
  EmailMetadata,
  SavedEmail,
  ProcessingStatus,
} from '../../../../application/interfaces/repositories/iemail-repository';
import { Email } from '../../../../domain/entities/email.entity';

@injectable()
export class PrismaEmailRepository implements IEmailRepository {
  constructor(
    @inject('PrismaClient') private prisma: PrismaClient
  ) {}

  async save(email: Email, metadata?: EmailMetadata): Promise<SavedEmail> {
    const record = await this.prisma.email.create({
      data: {
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
        matchedPatternName: metadata?.matchedPatternName,
      },
    });
    return this.toSavedEmail(record);
  }

  async findById(userId: string, emailId: string): Promise<SavedEmail | null> {
    const record = await this.prisma.email.findFirst({ where: { userId, emailId } });
    return record ? this.toSavedEmail(record) : null;
  }

  async updateProcessingStatus(emailId: string, status: ProcessingStatus): Promise<void> {
    await this.prisma.email.update({
      where: { emailId },
      data: {
        isProcessed: status.isProcessed,
        processedAt: status.processedAt,
        processingWorkflowId: status.workflowId,
        transactionId: status.transactionId,
        confidence: status.confidence,
        processingError: status.error,
        matchedPatternId: status.matchedPatternId,
        matchedPatternName: status.matchedPatternName,
      },
    });
  }

  async markAsProcessed(emailId: string): Promise<void> {
    await this.prisma.email.update({
      where: { emailId },
      data: { isProcessed: true, processedAt: new Date() },
    });
  }

  async findUnprocessed(limit?: number): Promise<SavedEmail[]> {
    const records = await this.prisma.email.findMany({
      where: { isProcessed: false },
      orderBy: { date: 'desc' },
      ...(limit ? { take: limit } : {}),
    });
    return records.map((r: any) => this.toSavedEmail(r));
  }

  async markDuplicate(emailId: string): Promise<void> {
    await this.prisma.email.update({
      where: { emailId },
      data: { processingError: 'Duplicate email' },
    });
  }

  async exists(emailId: string): Promise<boolean> {
    const count = await this.prisma.email.count({ where: { emailId } });
    return count > 0;
  }

  private toSavedEmail(record: any): SavedEmail {
    return {
      id: record.id,
      emailId: record.emailId,
      subject: record.subject,
      from: record.from,
      date: record.date,
      body: record.body ?? undefined,
      isProcessed: record.isProcessed,
      processedAt: record.processedAt ?? undefined,
      processingWorkflowId: record.processingWorkflowId ?? undefined,
      transactionId: record.transactionId ?? undefined,
      confidence: record.confidence ?? undefined,
      processingError: record.processingError ?? undefined,
    };
  }
}
