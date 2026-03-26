/**
 * Prisma Pattern Repository (Layer 3 - Interface Adapters)
 * Implements IPatternRepository — drop-in replacement for MongoDBPatternRepository.
 */
import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import { IPatternRepository } from '../../../../application/interfaces/repositories/ipattern-repository';
import { Email } from '../../../../domain/entities/email.entity';
import { EmailPattern } from '../../../../domain/entities/email-pattern.entity';

@injectable()
export class PrismaPatternRepository implements IPatternRepository {
  constructor(
    @inject('PrismaClient') private prisma: PrismaClient
  ) {}

  async findMatchingPattern(email: Email): Promise<EmailPattern | null> {
    const patterns = await this.findAllActive();
    if (patterns.length === 0) return null;

    const matches = patterns
      .map(pattern => ({
        pattern,
        score: pattern.calculateMatchScore(email.from, email.subject, email.body),
      }))
      .filter(m => m.score > 0)
      .filter(m => m.pattern.matches(email.from, email.subject, email.body));

    if (matches.length === 0) return null;

    matches.sort((a, b) => b.score - a.score);
    return matches[0].pattern;
  }

  async findById(patternId: string): Promise<EmailPattern | null> {
    const record = await this.prisma.emailPattern.findUnique({ where: { id: patternId } });
    return record ? this.toDomain(record) : null;
  }

  async findAllActive(): Promise<EmailPattern[]> {
    const records = await this.prisma.emailPattern.findMany({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
    });
    return records.map(r => this.toDomain(r));
  }

  async findAll(): Promise<EmailPattern[]> {
    const records = await this.prisma.emailPattern.findMany({
      orderBy: { priority: 'desc' },
    });
    return records.map(r => this.toDomain(r));
  }

  async updatePatternStats(patternId: string, success: boolean): Promise<void> {
    await this.prisma.emailPattern.update({
      where: { id: patternId },
      data: {
        matchCount: { increment: 1 },
        lastMatchedAt: new Date(),
      },
    });
  }

  async save(pattern: EmailPattern): Promise<EmailPattern> {
    const record = await this.prisma.emailPattern.upsert({
      where: { id: pattern.id },
      create: {
        name: pattern.name,
        bankName: pattern.bankName,
        accountType: pattern.accountType || 'checking',
        fromAddresses: pattern.fromAddresses,
        subjectPatterns: pattern.subjectPatterns,
        bodyKeywords: pattern.bodyKeywords,
        extractionPrompt: pattern.extractionPrompt,
        isActive: pattern.isActive,
        priority: pattern.priority,
      },
      update: {
        name: pattern.name,
        bankName: pattern.bankName,
        accountType: pattern.accountType || 'checking',
        fromAddresses: pattern.fromAddresses,
        subjectPatterns: pattern.subjectPatterns,
        bodyKeywords: pattern.bodyKeywords,
        extractionPrompt: pattern.extractionPrompt,
        isActive: pattern.isActive,
        priority: pattern.priority,
      },
    });
    return this.toDomain(record);
  }

  private toDomain(record: any): EmailPattern {
    return new EmailPattern(
      record.id,
      record.name,
      record.bankName,
      record.fromAddresses,
      record.subjectPatterns,
      record.bodyKeywords,
      record.extractionPrompt,
      record.isActive,
      record.priority,
      record.accountType
    );
  }
}
