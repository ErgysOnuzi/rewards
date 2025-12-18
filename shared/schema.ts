import { z } from "zod";
import { pgTable, text, integer, real, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

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
  ipHash: text("ip_hash"),
});

export const guaranteedWins = pgTable("guaranteed_wins", {
  id: serial("id").primaryKey(),
  stakeId: text("stake_id").notNull(),
  spinNumber: integer("spin_number").notNull(),
});

export const insertDemoUserSchema = createInsertSchema(demoUsers).omit({ id: true });
export const insertSpinLogSchema = createInsertSchema(spinLogs).omit({ id: true, timestamp: true });
export const insertGuaranteedWinSchema = createInsertSchema(guaranteedWins).omit({ id: true });

export type DemoUser = typeof demoUsers.$inferSelect;
export type InsertDemoUser = z.infer<typeof insertDemoUserSchema>;
export type SpinLog = typeof spinLogs.$inferSelect;
export type InsertSpinLog = z.infer<typeof insertSpinLogSchema>;
export type GuaranteedWin = typeof guaranteedWins.$inferSelect;

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
});

export type LookupRequest = z.infer<typeof lookupRequestSchema>;
export type SpinRequest = z.infer<typeof spinRequestSchema>;

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

export interface LookupResponse {
  stake_id: string;
  period_label?: string;
  wagered_amount: number;
  tickets_total: number;
  tickets_used: number;
  tickets_remaining: number;
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
}

export interface ErrorResponse {
  message: string;
  error?: string;
}
