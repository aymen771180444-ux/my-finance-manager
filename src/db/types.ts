import type { CurrencyCode } from '../engine/money';

/** Base fields every persisted row carries. */
export interface BaseRow {
  id: string; // uuid
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface Profile extends BaseRow {
  name: string;
  icon: string; // emoji or icon name
  color: string;
  isDefault: boolean;
}

export type AccountType = 'cash' | 'bank' | 'ewallet' | 'savings' | 'credit_card';

export interface Account extends BaseRow {
  profileId: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /** Opening balance in minor units. For credit cards: negative = amount owed. */
  openingBalanceMinor: number;
  /** Cached current balance in minor units; only the posting engine mutates it. */
  currentBalanceMinor: number;
  openedAt: string; // ISO date
  notes: string;
  status: 'active' | 'closed';
  /** Accounts explicitly shared into other profiles (PRD §25). */
  sharedWithProfileIds: string[];
}

export type TxnType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'lend' // money lent to someone (creates/feeds a receivable debt)
  | 'borrow' // money borrowed from someone (creates/feeds a payable debt)
  | 'debt_repayment' // repayment in either direction — direction comes from the linked debt
  | 'refund' // linked to an original expense
  | 'investment_buy'
  | 'investment_sell'
  | 'withdrawal' // bank/ewallet -> cash
  | 'deposit' // cash -> bank/ewallet
  | 'cc_purchase'
  | 'cc_payment';

export type PaymentMethod = 'cash' | 'bank_card' | 'bank_transfer' | 'ewallet' | 'online';

export interface Transaction extends BaseRow {
  profileId: string;
  type: TxnType;
  /** Always positive; sign semantics come from `type`. Minor units of `currency`. */
  amountMinor: number;
  currency: CurrencyCode;
  /** Exchange rate to base currency used AT TRANSACTION TIME; null = unknown. */
  fxRateToBase: number | null;
  /** Converted base-currency amount (minor units), frozen at txn time; null if no rate. */
  baseAmountMinor: number | null;
  /** Primary account (source for outflows, destination for inflows). */
  accountId: string;
  /** Counter account for transfer / deposit / withdrawal / cc_payment. */
  toAccountId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  date: string; // ISO date (yyyy-MM-dd)
  paymentMethod: PaymentMethod | null;
  person: string; // person or organization name ('' if none)
  notes: string;
  /** For refunds: the original expense txn; for debt ops: null (use debtId). */
  linkedTxnId: string | null;
  debtId: string | null;
  goalId: string | null;
  investmentId: string | null;
  attachmentIds: string[];
  location: string;
  /** Present only when the transaction is split across categories. */
  hasSplits: boolean;
}

export interface Split extends BaseRow {
  profileId: string;
  transactionId: string;
  categoryId: string;
  subcategoryId: string | null;
  amountMinor: number; // same currency as parent txn; children must sum to parent
  notes: string;
}

export type CategoryKind = 'expense' | 'income';
export type CategoryGroup =
  | 'essentials'
  | 'wants'
  | 'bills'
  | 'savings_investments'
  | 'emergencies'
  | 'work'
  | 'income';

export interface Category extends BaseRow {
  profileId: string;
  parentId: string | null; // null = top category, else subcategory
  kind: CategoryKind;
  group: CategoryGroup;
  /** i18n key for seeded defaults; user-created ones store the literal name here. */
  nameKey: string | null;
  nameAr: string;
  nameEn: string;
  color: string;
  icon: string; // lucide icon name
  isArchived: boolean;
}

export interface Tag extends BaseRow {
  profileId: string;
  name: string;
  color: string;
}

export interface TransactionTag extends BaseRow {
  profileId: string;
  transactionId: string;
  tagId: string;
}

export interface ExchangeRate extends BaseRow {
  /** rate: 1 unit of `currency` = `rateToBase` units of base (YER). */
  currency: CurrencyCode;
  rateToBase: number;
  date: string; // ISO date the rate applies from
  source: 'manual' | 'auto';
}

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'reconcile';

export interface AuditLogEntry extends BaseRow {
  profileId: string;
  table: string;
  rowId: string;
  action: AuditAction;
  /** JSON snapshots (null for create.before / delete.after). */
  before: string | null;
  after: string | null;
}

export interface TrashEntry extends BaseRow {
  profileId: string;
  table: string;
  rowId: string;
  /** Full JSON snapshot needed to restore the record (and dependents). */
  payload: string;
  /** Human label shown in the Trash screen. */
  label: string;
  deletedAt: string;
  /** deletedAt + 90 days. */
  purgeAt: string;
}

// ——— Stage 2 ———

export type BudgetPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Budget extends BaseRow {
  profileId: string;
  name: string;
  /** null = overall budget across all expense categories. */
  categoryId: string | null;
  period: BudgetPeriod;
  /** Budget limit per period, in BASE currency (YER) minor units. */
  amountMinor: number;
  /** First day the budget applies (rollover accumulates from here). */
  startDate: string;
  /** Optional end date for event budgets (travel, wedding, …). */
  endDate: string | null;
  rolloverEnabled: boolean;
  alertsEnabled: boolean;
  isArchived: boolean;
}

export interface SavingsGoal extends BaseRow {
  profileId: string;
  name: string;
  targetMinor: number;
  currency: CurrencyCode;
  targetDate: string | null;
  /** Savings account this goal lives in (optional). */
  linkedAccountId: string | null;
  /** Cached saved amount in goal currency minor units; repo-maintained. */
  savedMinor: number;
  /** Planned automatic monthly contribution (0 = none) — used for estimates. */
  autoMonthlyMinor: number;
  /** Automatic monthly saving: source account, day of month (1–28), last processed month (YYYY-MM). */
  autoFromAccountId?: string | null;
  autoDay?: number | null;
  autoLastMonth?: string | null;
  notes: string;
  status: 'active' | 'completed' | 'archived';
}

export interface SavingsContribution extends BaseRow {
  profileId: string;
  goalId: string;
  /** Positive = deposit, negative = withdrawal (goal currency minor units). */
  amountMinor: number;
  date: string;
  /** Linked transfer transaction when money actually moved between accounts. */
  txnId: string | null;
  notes: string;
}

export type DebtDirection = 'owed_to_me' | 'i_owe';

export interface Debt extends BaseRow {
  profileId: string;
  person: string;
  direction: DebtDirection;
  principalMinor: number;
  currency: CurrencyCode;
  startDate: string;
  dueDate: string | null;
  /** Optional installment plan. */
  installmentMinor: number | null;
  installmentPeriod: 'weekly' | 'monthly' | null;
  /** Cached outstanding amount; repo-maintained from repayments. */
  remainingMinor: number;
  notes: string;
  status: 'open' | 'settled';
}

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringObligation extends BaseRow {
  profileId: string;
  name: string;
  /** What gets created/reminded: an expense or an income. */
  kind: 'expense' | 'income';
  amountMinor: number;
  accountId: string;
  categoryId: string | null;
  frequency: RecurringFrequency;
  /** Every N frequency units (default 1). */
  interval: number;
  startDate: string;
  endDate: string | null;
  /** auto: create the transaction when due; remind: notify, user records it. */
  mode: 'auto' | 'remind';
  remindDaysBefore: number;
  /** Occurrences up to and including this date have been processed. */
  lastProcessed: string | null;
  status: 'active' | 'paused';
}

export type NotificationKind = 'budget' | 'recurring' | 'debt' | 'goal' | 'summary' | 'reminder' | 'backup' | 'sync';

export interface AppNotification extends BaseRow {
  profileId: string;
  kind: NotificationKind;
  /** i18n key + params so notifications follow the UI language. */
  titleKey: string;
  params: string; // JSON
  /** Dedupe key, e.g. budget:<id>:2026-11:90 — one notification per event. */
  dedupe: string;
  refId: string | null;
  read: boolean;
}

// ——— Stage 4 ———

/** Quantities are integers in millionths of a unit (0.5 grams → 500_000). */
export const QTY_SCALE = 1_000_000;

export type InvestmentType = 'stock' | 'fund' | 'crypto' | 'gold' | 'bond' | 'deposit' | 'other';

export interface Investment extends BaseRow {
  profileId: string;
  name: string;
  type: InvestmentType;
  currency: CurrencyCode;
  /** Free-text unit label: shares, grams, units… */
  unit: string;
  /** Cached holding (micro-units); repo-maintained from investmentTxns. */
  quantityMicro: number;
  /** Cached total cost basis of the CURRENT holding (minor units, average-cost method). */
  costBasisMinor: number;
  /** Cumulative realized gain/loss from sales (minor units). */
  realizedMinor: number;
  /** Last RECORDED price per unit (minor units) and its date — never invented. */
  lastPriceMinor: number | null;
  lastPriceDate: string | null;
  notes: string;
  status: 'active' | 'closed';
}

export interface InvestmentTxn extends BaseRow {
  profileId: string;
  investmentId: string;
  kind: 'buy' | 'sell' | 'valuation';
  /** For buy/sell; 0 for valuation. */
  quantityMicro: number;
  /** Price per unit (minor units). */
  priceMinor: number;
  /** quantity × price (+ fees on buy, − fees on sell); 0 for valuation. */
  totalMinor: number;
  feesMinor: number;
  /** For sells: proceeds − cost of the units sold. */
  realizedMinor: number;
  /** Cost basis removed by a sell (needed to reverse it exactly). */
  costRemovedMinor: number;
  date: string;
  /** Linked account transaction when money moved through an account. */
  txnId: string | null;
  notes: string;
}

export type AssetKind = 'cash_savings' | 'gold' | 'financial' | 'other';

export interface Asset extends BaseRow {
  profileId: string;
  name: string;
  kind: AssetKind;
  currency: CurrencyCode;
  /** Latest recorded value (minor units) and its date. */
  valueMinor: number;
  valuationDate: string;
  /** Optional quantity description (e.g. "50 g"). */
  quantityNote: string;
  notes: string;
  status: 'active' | 'disposed';
}

export interface AssetValuation extends BaseRow {
  profileId: string;
  assetId: string;
  valueMinor: number;
  date: string;
}

export interface DebtRepayment extends BaseRow {
  profileId: string;
  debtId: string;
  amountMinor: number;
  date: string;
  txnId: string | null;
  notes: string;
}

// ——— Stage 5 ———

export interface WrappedKey {
  iv: string;
  data: string;
}

/** Singleton (id 'vault'): app-lock configuration and the wrapped data key. */
export interface Vault extends BaseRow {
  iterations: number;
  pinSalt: string;
  pinWrapped: WrappedKey;
  recoverySalt: string;
  recoveryWrapped: WrappedKey;
  pinLength: number;
  /** WebAuthn credential + PRF salt, when biometric unlock is enrolled. */
  biometric: { credentialId: string; prfSalt: string; wrapped: WrappedKey } | null;
  autoLockMinutes: number;
  failedAttempts: number;
  lockedUntil: string | null;
}

export type AttachmentOwner = 'transaction' | 'account' | 'debt' | 'investment' | 'asset';

export interface Attachment extends BaseRow {
  profileId: string;
  ownerType: AttachmentOwner;
  ownerId: string;
  name: string;
  mime: string;
  /** Plaintext size in bytes. */
  size: number;
  /** When true, `data` is AES-GCM ciphertext under the vault DEK and `iv` is set. */
  encrypted: boolean;
  iv: string | null;
  data: Blob;
  /** Soft delete (Trash). */
  deletedAt: string | null;
}

export interface NotificationPrefs {
  system: boolean; // show device notifications (when permitted)
  budget: boolean;
  bills: boolean;
  installments: boolean;
  recurring: boolean;
  dailyReminder: boolean;
  dailyReminderHour: number; // 0-23
  dailySummary: boolean;
  weeklySummary: boolean;
  monthlySummary: boolean;
  backupReminder: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  system: false,
  budget: true,
  bills: true,
  installments: true,
  recurring: true,
  dailyReminder: false,
  dailyReminderHour: 20,
  dailySummary: false,
  weeklySummary: true,
  monthlySummary: true,
  backupReminder: true,
};

/** Singleton (id 'sync'): this device's Google Drive sync state. */
export interface SyncState {
  id: 'sync';
  deviceId: string;
  /** Google account the data is synced with (shown in Settings). */
  email: string | null;
  connectedAt: string | null;
  /** Sync key (raw AES-256). Wrapped with the app-lock data key when the lock is on. */
  key: { wrapped: boolean; iv: string | null; data: string } | null;
  /** Remote change/snapshot files already applied on this device. */
  applied: string[];
  lastSyncAt: string | null;
  lastSnapshotAt: string | null;
  lastError: string | null;
  failures: number;
}

/** Fingerprint of each record as of the last successful sync (detects local edits since). */
export interface SyncBaseEntry {
  key: string; // 'table:id'
  h: string;
}

/** Both devices edited the same record; one version was kept, the other is saved here. */
export interface SyncConflict {
  id: string;
  createdAt: string;
  table: string;
  rowId: string;
  kept: 'local' | 'remote';
  local: string | null; // JSON of this device's version (null = was deleted here)
  remote: string | null; // JSON of the other device's version (null = deleted there)
  resolvedAt: string | null;
}

export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface SyncQueueEntry extends BaseRow {
  profileId: string;
  op: 'create' | 'update' | 'delete';
  table: string;
  rowId: string;
  payload: string; // JSON
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
}

export interface Settings extends BaseRow {
  /** singleton row, id = 'settings' */
  language: 'ar' | 'en';
  theme: 'light' | 'dark' | 'auto';
  calendar: 'gregorian' | 'hijri';
  activeProfileId: string | null;
  hideBalances: boolean;
  dashboardCards: { id: string; visible: boolean }[];
  onboardingDone: boolean;
  notificationPrefs?: NotificationPrefs;
  lastBackupAt?: string | null;
  /** Preset name or 'custom' (then customColor is used). Default teal. */
  colorTheme?: string;
  customColor?: string;
}
