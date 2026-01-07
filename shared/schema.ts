import { z } from "zod";
import { pgTable, text, integer, real, timestamp, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Re-export auth schema (required for Replit Auth)
export * from "./models/auth";

// Case prize definition with value, probability, and rarity color
export interface CasePrize {
  value: number;       // Dollar value of the prize
  probability: number; // Probability as percentage (must total 100%)
  label: string;       // Display label
  color: "grey" | "lightblue" | "green" | "red" | "gold"; // Rarity color
}

// Case prize configuration - single case with weighted probabilities
// Probabilities must total 100%
export const CASE_PRIZES: CasePrize[] = [
  { value: 0, probability: 87.5, label: "$0", color: "grey" },
  { value: 2, probability: 8.0, label: "$2", color: "lightblue" },
  { value: 5, probability: 3.5, label: "$5", color: "green" },
  { value: 25, probability: 0.8, label: "$25", color: "red" },
  { value: 50, probability: 0.2, label: "$50", color: "gold" },
];

// Color mapping for CSS classes
export const PRIZE_COLORS = {
  grey: { bg: "bg-gray-500", text: "text-gray-100", border: "border-gray-400" },
  lightblue: { bg: "bg-blue-400", text: "text-blue-100", border: "border-blue-300" },
  green: { bg: "bg-green-500", text: "text-green-100", border: "border-green-400" },
  red: { bg: "bg-red-500", text: "text-red-100", border: "border-red-400" },
  gold: { bg: "bg-yellow-500", text: "text-yellow-100", border: "border-yellow-400" },
} as const;

// Validate that probabilities total 100%
export function validatePrizeProbabilities(prizes: CasePrize[]): boolean {
  const total = prizes.reduce((sum, p) => sum + p.probability, 0);
  return Math.abs(total - 100) < 0.01; // Allow small floating point error
}

// Weighted random selection using cumulative probability
export function selectCasePrize(prizes: CasePrize[] = CASE_PRIZES): CasePrize {
  const random = Math.random() * 100;
  let cumulative = 0;
  
  for (const prize of prizes) {
    cumulative += prize.probability;
    if (random <= cumulative) {
      return prize;
    }
  }
  
  // Fallback to first prize (should never happen if probabilities sum to 100)
  return prizes[0];
}

// Legacy type for backwards compatibility
export type SpinTier = "bronze" | "silver" | "gold";

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
  wageredAmount: real("wagered_amount").notNull(),
  spinNumber: integer("spin_number").notNull(),
  result: text("result").notNull(), // "WIN" or "LOSE"
  prizeLabel: text("prize_label").notNull(),
  prizeValue: integer("prize_value").default(0).notNull(), // Dollar amount won
  prizeColor: text("prize_color"), // "grey", "lightblue", "green", "red", "gold"
  isBonus: boolean("is_bonus").default(false).notNull(), // True for daily bonus spins
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

// User flags for blacklist/allowlist/disputed status
export const userFlags = pgTable("user_flags", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull().unique(),
  isBlacklisted: boolean("is_blacklisted").default(false).notNull(),
  isAllowlisted: boolean("is_allowlisted").default(false).notNull(),
  isDisputed: boolean("is_disputed").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Admin sessions for authentication
export const adminSessions = pgTable("admin_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastActivityAt: timestamp("last_activity_at").defaultNow(),
});

// Export logs for audit trail
export const exportLogs = pgTable("export_logs", {
  id: serial("id").primaryKey(),
  campaign: text("campaign").notNull(),
  weekLabel: text("week_label").notNull(),
  ticketUnit: integer("ticket_unit").notNull(),
  rowCount: integer("row_count").notNull(),
  totalTickets: integer("total_tickets").notNull(),
  dataHash: text("data_hash"), // SHA256 of the sheet data at export time
  exportedBy: text("exported_by").default("admin"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Feature toggles for runtime configuration
export const featureToggles = pgTable("feature_toggles", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Payouts for tracking prize distribution
export const payouts = pgTable("payouts", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull(),
  amount: integer("amount").notNull(),
  prize: text("prize"), // description of prize
  status: text("status").default("pending").notNull(), // "pending", "sent", "failed"
  transactionHash: text("transaction_hash"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

// Rate limit logs for abuse monitoring
export const rateLimitLogs = pgTable("rate_limit_logs", {
  id: serial("id").primaryKey(),
  ipHash: text("ip_hash").notNull(),
  stakeId: text("stake_id"),
  action: text("action").notNull(), // "spin", "bonus_denied", "lookup"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User state for tracking daily bonus and cooldowns
export const userState = pgTable("user_state", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull().unique(),
  lastBonusSpinAt: timestamp("last_bonus_spin_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Wager overrides for testing (bypass Google Sheets data)
export const wagerOverrides = pgTable("wager_overrides", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull().unique(),
  lifetimeWagered: integer("lifetime_wagered"), // Lifetime wagered in dollars
  yearToDateWagered: integer("year_to_date_wagered"), // 2026 wagered in dollars
  note: text("note"), // Admin note for why override exists
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Password reset tokens
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(), // References users.id
  tokenHash: text("token_hash").notNull(), // SHA-256 hash of token
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"), // Set when token is consumed
  requestIpHash: text("request_ip_hash"), // For security logging
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDemoUserSchema = createInsertSchema(demoUsers).omit({ id: true });
export const insertSpinLogSchema = createInsertSchema(spinLogs).omit({ id: true, timestamp: true });
export const insertGuaranteedWinSchema = createInsertSchema(guaranteedWins).omit({ id: true });
export const insertUserWalletSchema = createInsertSchema(userWallets).omit({ id: true, updatedAt: true });
export const insertUserSpinBalanceSchema = createInsertSchema(userSpinBalances).omit({ id: true });
export const insertWithdrawalRequestSchema = createInsertSchema(withdrawalRequests).omit({ id: true, createdAt: true, processedAt: true });
export const insertWalletTransactionSchema = createInsertSchema(walletTransactions).omit({ id: true, createdAt: true });
export const insertUserFlagSchema = createInsertSchema(userFlags).omit({ id: true, createdAt: true, updatedAt: true });
export const insertExportLogSchema = createInsertSchema(exportLogs).omit({ id: true, createdAt: true });
export const insertFeatureToggleSchema = createInsertSchema(featureToggles).omit({ id: true, updatedAt: true });
export const insertPayoutSchema = createInsertSchema(payouts).omit({ id: true, createdAt: true, processedAt: true });
export const insertRateLimitLogSchema = createInsertSchema(rateLimitLogs).omit({ id: true, createdAt: true });
export const insertUserStateSchema = createInsertSchema(userState).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWagerOverrideSchema = createInsertSchema(wagerOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({ id: true, createdAt: true });

export type DemoUser = typeof demoUsers.$inferSelect;
export type InsertDemoUser = z.infer<typeof insertDemoUserSchema>;
export type SpinLog = typeof spinLogs.$inferSelect;
export type InsertSpinLog = z.infer<typeof insertSpinLogSchema>;
export type GuaranteedWin = typeof guaranteedWins.$inferSelect;
export type UserWallet = typeof userWallets.$inferSelect;
export type UserSpinBalance = typeof userSpinBalances.$inferSelect;
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type UserFlag = typeof userFlags.$inferSelect;
export type ExportLog = typeof exportLogs.$inferSelect;
export type FeatureToggle = typeof featureToggles.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type RateLimitLog = typeof rateLimitLogs.$inferSelect;
export type UserState = typeof userState.$inferSelect;
export type WagerOverride = typeof wagerOverrides.$inferSelect;
export type InsertWagerOverride = z.infer<typeof insertWagerOverrideSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;

export const stakeIdSchema = z
  .string()
  .min(2, "Stake ID must be at least 2 characters")
  .max(32, "Stake ID must be at most 32 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Stake ID can only contain letters, numbers, and underscores")
  .transform((val) => val.trim());

export const lookupRequestSchema = z.object({
  stake_id: stakeIdSchema,
  domain: z.enum(["us", "com"]).optional().default("com"), // Stake domain for weighted wager lookup
});

// Simplified spin request - just stake_id, no tiers
export const spinRequestSchema = z.object({
  stake_id: stakeIdSchema,
  domain: z.enum(["us", "com"]).optional().default("com"),
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
  wagered_amount: number;        // From weighted sheets (2026) - used for ticket calculation
  lifetime_wagered: number;      // From NGR sheet - for display only
  tickets_total: number;
  tickets_used: number;
  tickets_remaining: number;
  wallet_balance: number;
  spin_balances: SpinBalances;
  pending_withdrawals: number;
  can_daily_bonus: boolean;      // Whether daily bonus spin is available
  next_bonus_at?: string;        // ISO timestamp when next bonus is available
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
  prize_color: "grey" | "lightblue" | "green" | "red" | "gold";
  wallet_balance: number;
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
