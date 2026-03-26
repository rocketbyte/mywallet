/**
 * Prisma Transaction Repository (Layer 3 - Interface Adapters)
 * Implements ITransactionRepository — drop-in replacement for MongoDBTransactionRepository.
 */
import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import {
  ITransactionRepository,
  TransactionFilters,
  StatsParams,
  TransactionStats,
} from '../../../../application/interfaces/repositories/itransaction-repository';
import { Transaction } from '../../../../domain/entities/transaction.entity';

@injectable()
export class PrismaTransactionRepository implements ITransactionRepository {
  constructor(
    @inject('PrismaClient') private prisma: PrismaClient
  ) {}

  async save(transaction: Transaction): Promise<Transaction> {
    const record = await this.prisma.transaction.create({
      data: {
        emailId: transaction.emailId,
        transactionDate: transaction.transactionDate,
        merchant: transaction.merchant,
        amount: transaction.amount,
        currency: transaction.currency,
        category: transaction.category,
        subcategory: transaction.subcategory,
        transactionType: transaction.transactionType,
        accountNumber: transaction.accountNumber,
        bankName: transaction.bankName || '',
        extractedData: (transaction.rawData as any) || {},
        confidence: transaction.confidence,
        processedAt: new Date(),
      },
    });
    return this.toDomain(record);
  }

  async findById(id: string): Promise<Transaction | null> {
    const record = await this.prisma.transaction.findUnique({ where: { id } });
    return record ? this.toDomain(record) : null;
  }

  async findByEmailId(emailId: string): Promise<Transaction | null> {
    const record = await this.prisma.transaction.findUnique({ where: { emailId } });
    return record ? this.toDomain(record) : null;
  }

  async findAll(filters?: TransactionFilters): Promise<Transaction[]> {
    const where: any = {};

    if (filters) {
      if (filters.startDate || filters.endDate) {
        where.transactionDate = {};
        if (filters.startDate) where.transactionDate.gte = filters.startDate;
        if (filters.endDate) where.transactionDate.lte = filters.endDate;
      }
      if (filters.category) where.category = filters.category;
      if (filters.bankName) where.bankName = filters.bankName;
      if (filters.transactionType) where.transactionType = filters.transactionType;
      if (filters.minAmount || filters.maxAmount) {
        where.amount = {};
        if (filters.minAmount) where.amount.gte = filters.minAmount;
        if (filters.maxAmount) where.amount.lte = filters.maxAmount;
      }
    }

    const records = await this.prisma.transaction.findMany({
      where,
      orderBy: { transactionDate: 'desc' },
    });
    return records.map(r => this.toDomain(r));
  }

  async getStats(params: StatsParams): Promise<TransactionStats> {
    const where: any = {};
    if (params.startDate || params.endDate) {
      where.transactionDate = {};
      if (params.startDate) where.transactionDate.gte = params.startDate;
      if (params.endDate) where.transactionDate.lte = params.endDate;
    }

    const totals = await this.prisma.transaction.aggregate({
      where,
      _count: { id: true },
      _sum: { amount: true },
      _avg: { amount: true },
    });

    const stats: TransactionStats = {
      totalCount: totals._count.id,
      totalAmount: totals._sum.amount ?? 0,
      averageAmount: totals._avg.amount ?? 0,
    };

    if (params.groupBy === 'category') {
      const groups = await this.prisma.transaction.groupBy({
        by: ['category'],
        where,
        _count: { id: true },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      });

      stats.categories = groups.map(g => ({
        category: g.category,
        count: g._count.id,
        totalAmount: g._sum.amount ?? 0,
        percentage: stats.totalAmount > 0
          ? ((g._sum.amount ?? 0) / stats.totalAmount) * 100
          : 0,
      }));
    }

    return stats;
  }

  private toDomain(record: any): Transaction {
    return new Transaction(
      record.id,
      record.emailId,
      record.transactionDate,
      record.merchant,
      record.amount,
      record.currency,
      record.category,
      record.transactionType,
      record.accountNumber,
      record.confidence,
      record.bankName,
      record.subcategory ?? undefined,
      record.extractedData
    );
  }
}
