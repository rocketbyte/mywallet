export interface BudgetCategoryDTO {
  category: string;
  budget: number;
  spent: number;
}

export interface BudgetDTO {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  limitAmount: number;
  categories: BudgetCategoryDTO[];
}

export interface UpsertBudgetInput {
  periodStart?: string;
  limitAmount: number;
  categories?: { category: string; budget: number }[];
}
