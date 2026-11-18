import Dexie, { type Table } from 'dexie';
import type {
  Profile,
  Account,
  Transaction,
  Split,
  Category,
  Tag,
  TransactionTag,
  ExchangeRate,
  AuditLogEntry,
  TrashEntry,
  SyncQueueEntry,
  Settings,
  Budget,
  SavingsGoal,
  SavingsContribution,
  Debt,
  RecurringObligation,
  AppNotification,
  Investment,
  InvestmentTxn,
  Asset,
  AssetValuation,
  DebtRepayment,
  Vault,
  Attachment,
  SyncState,
  SyncBaseEntry,
  SyncConflict,
} from './types';

export class FinanceDB extends Dexie {
  profiles!: Table<Profile, string>;
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  splits!: Table<Split, string>;
  categories!: Table<Category, string>;
  tags!: Table<Tag, string>;
  transactionTags!: Table<TransactionTag, string>;
  exchangeRates!: Table<ExchangeRate, string>;
  auditLog!: Table<AuditLogEntry, string>;
  trash!: Table<TrashEntry, string>;
  syncQueue!: Table<SyncQueueEntry, string>;
  settings!: Table<Settings, string>;
  budgets!: Table<Budget, string>;
  savingsGoals!: Table<SavingsGoal, string>;
  savingsContributions!: Table<SavingsContribution, string>;
  debts!: Table<Debt, string>;
  recurringObligations!: Table<RecurringObligation, string>;
  notifications!: Table<AppNotification, string>;
  investments!: Table<Investment, string>;
  investmentTxns!: Table<InvestmentTxn, string>;
  assets!: Table<Asset, string>;
  assetValuations!: Table<AssetValuation, string>;
  debtRepayments!: Table<DebtRepayment, string>;
  vault!: Table<Vault, string>;
  attachments!: Table<Attachment, string>;
  syncState!: Table<SyncState, string>;
  syncBase!: Table<SyncBaseEntry, string>;
  syncConflicts!: Table<SyncConflict, string>;

  constructor(name = 'my-finance-manager') {
    super(name);
    this.version(1).stores({
      profiles: 'id, name',
      accounts: 'id, profileId, [profileId+status], type',
      transactions:
        'id, profileId, [profileId+date], [profileId+accountId], [profileId+categoryId], [profileId+type], toAccountId, debtId, goalId, investmentId, linkedTxnId, date',
      splits: 'id, transactionId, [profileId+categoryId]',
      categories: 'id, profileId, [profileId+parentId], [profileId+kind]',
      tags: 'id, profileId',
      transactionTags: 'id, transactionId, tagId, [profileId+tagId]',
      exchangeRates: 'id, [currency+date], currency, date',
      auditLog: 'id, [profileId+createdAt], [table+rowId], createdAt',
      trash: 'id, profileId, purgeAt, deletedAt',
      syncQueue: 'id, status, [profileId+status], createdAt',
      settings: 'id',
    });
    this.version(2).stores({
      budgets: 'id, profileId, categoryId',
      savingsGoals: 'id, profileId, linkedAccountId',
      savingsContributions: 'id, goalId, [profileId+date]',
      debts: 'id, profileId, [profileId+status], dueDate',
      recurringObligations: 'id, profileId, [profileId+status]',
      notifications: 'id, [profileId+read], dedupe, createdAt',
    });
    // v3: booleans are not indexable in IndexedDB — [profileId+read] never
    // matched anything. Use a plain profileId index and filter `read` in code.
    this.version(3).stores({
      notifications: 'id, profileId, dedupe, createdAt',
    });
    this.version(4)
      .stores({
        investments: 'id, profileId',
        investmentTxns: 'id, investmentId, [profileId+date], txnId',
        assets: 'id, profileId',
        assetValuations: 'id, assetId, [profileId+date]',
        debtRepayments: 'id, debtId, [profileId+date], txnId',
      })
      .upgrade(async (tx) => {
        // Back-fill repayment history from existing repayment transactions so
        // historical net worth can be reconstructed for pre-v4 data.
        const txns = (await tx.table('transactions').toArray()).filter((t: { type: string }) => t.type === 'debt_repayment');
        for (const t of txns as { id: string; profileId: string; debtId: string | null; amountMinor: number; date: string; createdAt: string }[]) {
          if (!t.debtId) continue;
          await tx.table('debtRepayments').add({
            id: crypto.randomUUID(),
            createdAt: t.createdAt,
            updatedAt: t.createdAt,
            profileId: t.profileId,
            debtId: t.debtId,
            amountMinor: t.amountMinor,
            date: t.date,
            txnId: t.id,
            notes: '',
          });
        }
      });
    this.version(5).stores({
      vault: 'id',
      attachments: 'id, profileId, [ownerType+ownerId]',
    });
    this.version(6).stores({
      syncState: 'id',
      syncBase: 'key',
      syncConflicts: 'id, createdAt',
    });
  }
}

export const db = new FinanceDB();

export function newId(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
