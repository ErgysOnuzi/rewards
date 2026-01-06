import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar, boolean, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // Stake verification fields
  stakeUsername: varchar("stake_username"),
  stakePlatform: varchar("stake_platform"), // "us" or "com"
  verificationStatus: varchar("verification_status").default("unverified"), // "unverified", "pending", "verified", "rejected"
  verifiedAt: timestamp("verified_at"),
  securityDisclaimerAccepted: boolean("security_disclaimer_accepted").default(false),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Verification requests table - for admin review of bet ID submissions
export const verificationRequests = pgTable("verification_requests", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  stakeUsername: varchar("stake_username").notNull(),
  stakePlatform: varchar("stake_platform").notNull(), // "us" or "com"
  betId: varchar("bet_id").notNull(), // Stake bet ID for verification
  status: varchar("status").default("pending").notNull(), // "pending", "approved", "rejected"
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  processedBy: varchar("processed_by"),
});

export const insertVerificationRequestSchema = createInsertSchema(verificationRequests).omit({ 
  id: true, 
  createdAt: true, 
  processedAt: true, 
  processedBy: true,
  status: true,
  adminNotes: true,
});

export type VerificationRequest = typeof verificationRequests.$inferSelect;
export type InsertVerificationRequest = z.infer<typeof insertVerificationRequestSchema>;
