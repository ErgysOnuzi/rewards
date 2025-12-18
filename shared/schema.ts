import { z } from "zod";
import { pgTable, text, integer, real, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Spin tier types
export type SpinTier = "bronze" | "silver" | "gold";

// Tier configuration (prize values and costs)
export const TIER_CONFIG = {
  bronze: { prizeValue: 5, cost: 5 },
  silver: { prizeValue: 25, cost: 25 },
  gold: { prizeValue: 100, cost: 100 },
} as const;

// Conversion rates: 5 bronze = 1 silver, 10 silver = 1 gold
export const CONVERSION_RATES = {
  bronze_to_silver: 5,
  silver_to_gold: 10,
} as const;

// Database tables
export const demoUsers = pgTable("demo_users", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull().unique(),
  wageredAmount: integer("wagered_amount").notNull(),
  periodLabel: text("period_label").notNull(),
});

export const spinLogs = pgTable("spin_logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  stakeId: text("stake_id").notNull(),
  wageredAmount: integer("wagered_amount").notNull(),
  spinNumber: integer("spin_number").notNull(),
  result: text("result").notNull(), // "WIN" or "LOSE"
  prizeLabel: text("prize_label").notNull(),
  prizeValue: integer("prize_value").default(0).notNull(), // Dollar amount won
  ipHash: text("ip_hash"),
});

export const guaranteedWins = pgTable("guaranteed_wins", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull(),
  spinNumber: integer("spin_number").notNull(),
});

// User wallet - tracks total available balance for purchases/withdrawals
export const userWallets = pgTable("user_wallets", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull().unique(),
  balance: integer("balance").default(0).notNull(), // Total winnings in dollars
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// User spin balances per tier
export const userSpinBalances = pgTable("user_spin_balances", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull(),
  tier: text("tier").notNull(), // "bronze", "silver", "gold"
  balance: integer("balance").default(0).notNull(),
});

// Withdrawal requests
export const withdrawalRequests = pgTable("withdrawal_requests", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").default("pending").notNull(), // "pending", "approved", "rejected"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  adminNotes: text("admin_notes"),
});

// Wallet transactions for audit trail
export const walletTransactions = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull(),
  type: text("type").notNull(), // "win", "purchase", "withdrawal"
  amount: integer("amount").notNull(), // positive for win, negative for spend
  tier: text("tier"), // for spin purchases
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDemoUserSchema = createInsertSchema(demoUsers).omit({ id: true });
export const insertSpinLogSchema = createInsertSchema(spinLogs).omit({ id: true, timestamp: true });
export const insertGuaranteedWinSchema = createInsertSchema(guaranteedWins).omit({ id: true });
export const insertUserWalletSchema = createInsertSchema(userWallets).omit({ id: true, updatedAt: true });
export const insertUserSpinBalanceSchema = createInsertSchema(userSpinBalances).omit({ id: true });
export const insertWithdrawalRequestSchema = createInsertSchema(withdrawalRequests).omit({ id: true, createdAt: true, processedAt: true });
export const insertWalletTransactionSchema = createInsertSchema(walletTransactions).omit({ id: true, createdAt: true });

export type DemoUser = typeof demoUsers.$inferSelect;
export type InsertDemoUser = z.infer<typeof insertDemoUserSchema>;
export type SpinLog = typeof spinLogs.$inferSelect;
export type InsertSpinLog = z.infer<typeof insertSpinLogSchema>;
export type GuaranteedWin = typeof guaranteedWins.$inferSelect;
export type UserWallet = typeof userWallets.$inferSelect;
export type UserSpinBalance = typeof userSpinBalances.$inferSelect;
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;
export type WalletTransaction = typeof walletTransactions.$inferSelect;

export const stakeIdSchema = z
  .string()
  .min(2, "Stake ID must be at least 2 characters")
  .max(32, "Stake ID must be at most 32 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Stake ID can only contain letters, numbers, and underscores")
  .transform((val) => val.trim());

export const lookupRequestSchema = z.object({
  stake_id: stakeIdSchema,
});

export const spinRequestSchema = z.object({
  stake_id: stakeIdSchema,
  tier: z.enum(["bronze", "silver", "gold"]).optional().default("bronze"),
});

export const convertSpinsRequestSchema = z.object({
  stake_id: stakeIdSchema,
  from_tier: z.enum(["bronze", "silver"]),
  to_tier: z.enum(["silver", "gold"]),
  quantity: z.number().int().positive(),
});

export const purchaseSpinsRequestSchema = z.object({
  stake_id: stakeIdSchema,
  tier: z.enum(["bronze", "silver", "gold"]),
  quantity: z.number().int().positive(),
});

export const withdrawRequestSchema = z.object({
  stake_id: stakeIdSchema,
  amount: z.number().int().positive(),
});

export const processWithdrawalSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["approved", "rejected"]),
  admin_notes: z.string().optional(),
});

export type LookupRequest = z.infer<typeof lookupRequestSchema>;
export type SpinRequest = z.infer<typeof spinRequestSchema>;
export type ConvertSpinsRequest = z.infer<typeof convertSpinsRequestSchema>;
export type PurchaseSpinsRequest = z.infer<typeof purchaseSpinsRequestSchema>;
export type WithdrawRequest = z.infer<typeof withdrawRequestSchema>;
export type ProcessWithdrawalRequest = z.infer<typeof processWithdrawalSchema>;

export interface WagerRow {
  stakeId: string;
  wageredAmount: number;
  periodLabel?: string;
  updatedAt?: string;
}

export interface SpinLogRow {
  timestampIso: string;
  stakeId: string;
  wageredAmount: number;
  ticketsTotal: number;
  ticketsUsedBefore: number;
  ticketsUsedAfter: number;
  ticketsRemainingAfter: number;
  result: "WIN" | "LOSE";
  winProbability: number;
  prizeLabel: string;
  requestId: string;
  ipHash: string;
  userAgent: string;
}

export interface SpinBalances {
  bronze: number;
  silver: number;
  gold: number;
}

export interface LookupResponse {
  stake_id: string;
  period_label?: string;
  wagered_amount: number;
  tickets_total: number;
  tickets_used: number;
  tickets_remaining: number;
  wallet_balance: number;
  spin_balances: SpinBalances;
  pending_withdrawals: number;
}

export interface SpinResponse {
  stake_id: string;
  wagered_amount: number;
  tickets_total: number;
  tickets_used_before: number;
  tickets_used_after: number;
  tickets_remaining_after: number;
  result: "WIN" | "LOSE";
  prize_label: string;
  prize_value: number;
  tier: SpinTier;
  wallet_balance: number;
  spin_balances: SpinBalances;
}

export interface ConvertSpinsResponse {
  success: boolean;
  from_tier: SpinTier;
  to_tier: SpinTier;
  quantity_converted: number;
  spin_balances: SpinBalances;
}

export interface PurchaseSpinsResponse {
  success: boolean;
  tier: SpinTier;
  quantity: number;
  cost: number;
  wallet_balance: number;
  spin_balances: SpinBalances;
}

export interface WithdrawResponse {
  success: boolean;
  request_id: number;
  amount: number;
  wallet_balance: number;
  pending_withdrawals: number;
}

export interface ErrorResponse {
  message: string;
  error?: string;
}
