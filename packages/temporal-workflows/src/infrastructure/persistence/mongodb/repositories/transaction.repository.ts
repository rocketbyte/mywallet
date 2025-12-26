/**
 * MongoDB Transaction Repository (Layer 3 - Interface Adapters)
 * Implements ITransactionRepository interface
 * Maps between Domain entities and Mongoose documents
 */
import { injectable, inject } from 'tsyringe';
import { Connection } from 'mongoose';
import { ITransactionRepository, TransactionFilters, StatsParams, TransactionStats } from '../../../../application/interfaces/repositories/itransaction-repository';
import { Transaction } from '../../../../domain/entities/transaction.entity';
import { Transaction as TransactionModel, ITransaction } from '../../../../models/transaction.model';

@injectable()
export class MongoDBTransactionRepository implements ITransactionRepository {
  constructor(
    @inject('MongoConnection') private connection: Connection
  ) {}

  /**
   * Save transaction to MongoDB
   */
  async save(transaction: Transaction): Promise<Transaction> {
    const doc = await TransactionModel.create({
      emailId: transaction.emailId,
      emailSubject: '', // Will be populated from email
      emailDate: new Date(),
      emailFrom: '',
      transactionDate: transaction.transactionDate,
      merchant: transaction.merchant,
      amount: transaction.amount,
      currency: transaction.currency,
      category: transaction.category,
      subcategory: transaction.subcategory,
      transactionType: transaction.transactionType,
      accountNumber: transaction.accountNumber,
      bankName: transaction.bankName || '',
      rawEmailText: '', // Will be populated from email
      extractedData: transaction.rawData || {},
      confidence: transaction.confidence,
      workflowId: '', // Will be set by caller
      workflowRunId: '',
      processedAt: new Date()
    });

    return this.toDomain(doc);
  }

  /**
   * Find transaction by ID
   */
  async findById(id: string): Promise<Transaction | null> {
    const doc = await TransactionModel.findById(id);
    return doc ? this.toDomain(doc) : null;
  }

  /**
   * Find transaction by email ID
   */
  async findByEmailId(emailId: string): Promise<Transaction | null> {
    const doc = await TransactionModel.findOne({ emailId });
    return doc ? this.toDomain(doc) : null;
  }

  /**
   * Find all transactions matching filters
   */
  async findAll(filters?: TransactionFilters): Promise<Transaction[]> {
    const query: any = {};

    if (filters) {
      if (filters.startDate || filters.endDate) {
        query.transactionDate = {};
        if (filters.startDate) query.transactionDate.$gte = filters.startDate;
        if (filters.endDate) query.transactionDate.$lte = filters.endDate;
      }

      if (filters.category) {
        query.category = filters.category;
      }

      if (filters.minAmount || filters.maxAmount) {
        query.amount = {};
        if (filters.minAmount) query.amount.$gte = filters.minAmount;
        if (filters.maxAmount) query.amount.$lte = filters.maxAmount;
      }

      if (filters.bankName) {
        query.bankName = filters.bankName;
      }

      if (filters.transactionType) {
        query.transactionType = filters.transactionType;
      }
    }

    const docs = await TransactionModel.find(query).sort({ transactionDate: -1 });
    return docs.map(doc => this.toDomain(doc));
  }

  /**
   * Get transaction statistics
   */
  async getStats(params: StatsParams): Promise<TransactionStats> {
    const match: any = {};

    if (params.startDate || params.endDate) {
      match.transactionDate = {};
      if (params.startDate) match.transactionDate.$gte = params.startDate;
      if (params.endDate) match.transactionDate.$lte = params.endDate;
    }

    const totalResult = await TransactionModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          averageAmount: { $avg: '$amount' }
        }
      }
    ]);

    const stats: TransactionStats = {
      totalCount: totalResult[0]?.totalCount || 0,
      totalAmount: totalResult[0]?.totalAmount || 0,
      averageAmount: totalResult[0]?.averageAmount || 0
    };

    // Get category stats if requested
    if (params.groupBy === 'category') {
      const categoryStats = await TransactionModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' }
          }
        },
        { $sort: { totalAmount: -1 } }
      ]);

      stats.categories = categoryStats.map(c => ({
        category: c._id,
        count: c.count,
        totalAmount: c.totalAmount,
        percentage: (c.totalAmount / stats.totalAmount) * 100
      }));
    }

    return stats;
  }

  /**
   * Map Mongoose document to Domain entity
   */
  private toDomain(doc: ITransaction): Transaction {
    return new Transaction(
      doc._id.toString(),
      doc.emailId,
      doc.transactionDate,
      doc.merchant,
      doc.amount,
      doc.currency,
      doc.category,
      doc.transactionType,
      doc.accountNumber,
      doc.confidence,
      doc.bankName,
      doc.subcategory,
      doc.extractedData
    );
  }
}
