import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar, boolean, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for custom auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table with custom auth (username/password)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: varchar("username").unique().notNull(),
  passwordHash: varchar("password_hash").notNull(),
  email: varchar("email"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  profileImageUrl: text("profile_image_url"),
  // Stake verification fields
  stakeUsername: varchar("stake_username"),
  stakePlatform: varchar("stake_platform"), // "us" or "com"
  verificationStatus: varchar("verification_status").default("unverified"), // "unverified", "pending", "verified", "rejected"
  verifiedAt: timestamp("verified_at"),
  securityDisclaimerAccepted: boolean("security_disclaimer_accepted").default(false),
  // Soft delete field - when set, user is considered deleted
  deletedAt: timestamp("deleted_at"),
  // Referral system fields
  referralCode: varchar("referral_code").unique(), // Unique code for sharing
  referredBy: varchar("referred_by"), // User ID of referrer
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Verification requests table - for admin review of screenshot uploads
export const verificationRequests = pgTable("verification_requests", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  stakeUsername: varchar("stake_username").notNull(),
  stakePlatform: varchar("stake_platform").notNull(), // "us" or "com"
  screenshotUrl: text("screenshot_url").notNull(), // URL/path to uploaded screenshot
  screenshotFilename: varchar("screenshot_filename"), // Original filename
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

// Registration schema - username must match a Stake username from the spreadsheet
export const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(30, "Username must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  email: z.string().email("Please enter a valid email address"),
  stakePlatform: z.enum(["us", "com"], { required_error: "Please select your Stake platform" }),
  referralCode: z.string().optional(), // Optional referral code from another user
});

// Login schema
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerificationRequest = typeof verificationRequests.$inferSelect;
export type InsertVerificationRequest = z.infer<typeof insertVerificationRequestSchema>;
