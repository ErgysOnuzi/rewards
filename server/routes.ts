import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { 
  lookupRequestSchema, spinRequestSchema, convertSpinsRequestSchema, 
  purchaseSpinsRequestSchema, withdrawRequestSchema, processWithdrawalSchema,
  spinLogs, userWallets, userSpinBalances, 
  withdrawalRequests, walletTransactions,
  userFlags, adminSessions, exportLogs, featureToggles, payouts, rateLimitLogs, userState, guaranteedWins,
  wagerOverrides, passwordResetTokens, sessions,
  CASE_PRIZES, selectCasePrize, validatePrizeProbabilities, type CasePrize, type SpinBalances,
  users, verificationRequests, registerSchema, loginSchema
} from "@shared/schema";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";
import type { 
  LookupResponse, SpinResponse, ErrorResponse,
  ConvertSpinsResponse, PurchaseSpinsResponse, WithdrawResponse
} from "@shared/schema";
import { getWagerRow, calculateTickets, getCacheStatus, refreshCache, getAllWagerData, computeDataHash, getWeightedWager, getWeightedCacheStatus, getWeightedWagerWithDomain, usernameExistsInSpreadsheet } from "./lib/sheets";
import { hashIp, maskUsername } from "./lib/hash";
import { isRateLimited, isStakeIdRateLimited, isAdminLoginRateLimited, getAdminLoginLockoutMs, resetAdminLoginAttempts } from "./lib/rateLimit";
import { config } from "./lib/config";
import { encrypt, decrypt } from "./lib/encryption";
import { ZodError, z } from "zod";
import { db } from "./db";
import { eq, desc, sql, and, gte, lt } from "drizzle-orm";
import crypto from "crypto";
import { 
  logSecurityEvent, 
  SESSION_CONFIG, 
  hashForLogging, 
  getClientIpForSecurity,
  generateCSRFToken,
  getRecentSecurityEvents
} from "./lib/security";


// Count regular spins for a user from database (excludes bonus spins)
async function countSpinsForStakeId(stakeId: string): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(spinLogs)
    .where(and(
      eq(spinLogs.stakeId, stakeId),
      eq(spinLogs.isBonus, false)
    ));
  return Number(result[0]?.count || 0);
}

// Helper functions for wallet and spin balances
async function getWalletBalance(stakeId: string): Promise<number> {
  const [wallet] = await db.select().from(userWallets).where(eq(userWallets.stakeId, stakeId));
  return wallet?.balance || 0;
}

async function updateWalletBalance(stakeId: string, delta: number): Promise<number> {
  const [existing] = await db.select().from(userWallets).where(eq(userWallets.stakeId, stakeId));
  if (existing) {
    const newBalance = existing.balance + delta;
    await db.update(userWallets)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(userWallets.stakeId, stakeId));
    return newBalance;
  } else {
    await db.insert(userWallets).values({ stakeId, balance: delta });
    return delta;
  }
}

async function getSpinBalances(stakeId: string): Promise<SpinBalances> {
  const balances = await db.select().from(userSpinBalances).where(eq(userSpinBalances.stakeId, stakeId));
  const result: SpinBalances = { bronze: 0, silver: 0, gold: 0 };
  for (const b of balances) {
    if (b.tier === "bronze" || b.tier === "silver" || b.tier === "gold") {
      result[b.tier] = b.balance;
    }
  }
  return result;
}


async function getPendingWithdrawals(stakeId: string): Promise<number> {
  const result = await db.select({ sum: sql<number>`COALESCE(SUM(amount), 0)` })
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.stakeId, stakeId), eq(withdrawalRequests.status, "pending")));
  return Number(result[0]?.sum || 0);
}

function getClientIp(req: Request): string {
  // Use socket IP as primary - more reliable than X-Forwarded-For which can be spoofed
  const socketIp = req.socket.remoteAddress || "";
  
  // Only trust X-Forwarded-For in production behind known proxy
  // For now, prefer socket IP to prevent spoofing
  if (socketIp && socketIp !== "::1" && socketIp !== "127.0.0.1") {
    return socketIp;
  }
  
  // Fallback to forwarded header only for local development
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  
  return socketIp || "unknown";
}

// Check if user is blacklisted - fails CLOSED (throws on error for security)
async function checkUserBlacklist(stakeId: string): Promise<{ blacklisted: boolean; error?: string }> {
  try {
    const [flags] = await db.select().from(userFlags).where(eq(userFlags.stakeId, stakeId.toLowerCase()));
    return { blacklisted: flags?.isBlacklisted === true };
  } catch (error) {
    console.error("Blacklist check failed for", stakeId, error);
    return { blacklisted: false, error: "Security check failed. Please try again." };
  }
}

// Get wager override for testing (bypasses Google Sheets data)
async function getWagerOverride(stakeId: string): Promise<{
  lifetimeWagered: number | null;
  yearToDateWagered: number | null;
} | null> {
  try {
    const [override] = await db.select()
      .from(wagerOverrides)
      .where(eq(wagerOverrides.stakeId, stakeId.toLowerCase()));
    if (override) {
      console.log(`[WagerOverride] Found override for ${stakeId}:`, {
        lifetime: override.lifetimeWagered,
        ytd: override.yearToDateWagered,
      });
      return {
        lifetimeWagered: override.lifetimeWagered,
        yearToDateWagered: override.yearToDateWagered,
      };
    }
    return null;
  } catch (error) {
    console.error("Wager override check failed:", error);
    return null;
  }
}

// Configure multer for file uploads with security hardening
const uploadsDir = path.join(process.cwd(), "uploads", "verification");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Allowed file extensions and MIME types (double validation)
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // SECURITY: Use cryptographically secure random bytes for filename
    const uniqueSuffix = crypto.randomBytes(16).toString("hex");
    // SECURITY: Sanitize extension - only allow whitelisted extensions
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : ".jpg";
    cb(null, `verification-${uniqueSuffix}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max (reduced from 10MB)
    files: 1, // Only allow 1 file per request
  },
  fileFilter: (req, file, cb) => {
    // SECURITY: Validate both MIME type and file extension
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeTypeValid = ALLOWED_MIME_TYPES.includes(file.mimetype);
    const extensionValid = ALLOWED_EXTENSIONS.includes(ext);
    
    if (mimeTypeValid && extensionValid) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (JPEG, PNG, GIF, WebP) are allowed"));
    }
  },
});

// Password hashing configuration
const SALT_ROUNDS = 12;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // =================== CUSTOM AUTHENTICATION ===================
  
  // Register new user - username must exist in the appropriate spreadsheet
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const parsed = registerSchema.parse(req.body);
      const { username, password, email, stakePlatform } = parsed;
      
      // Validate username exists in the appropriate spreadsheet
      const { usernameExistsInSpreadsheet } = await import("./lib/sheets");
      const existsInSheet = usernameExistsInSpreadsheet(username, stakePlatform);
      if (!existsInSheet) {
        return res.status(400).json({ 
          message: `Username "${username}" not found in ${stakePlatform === "us" ? "Stake.us" : "Stake.com"} records. Please use your Stake username.` 
        });
      }
      
      // Check if username already exists in our database
      const [existing] = await db.select().from(users).where(eq(users.username, username.toLowerCase()));
      if (existing) {
        return res.status(400).json({ message: "Username already registered" });
      }
      
      // Hash password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      
      // Encrypt sensitive data before storage
      const encryptedEmail = encrypt(email);
      
      // Create user with stake info pre-filled (still needs verification)
      const [newUser] = await db.insert(users).values({
        username: username.toLowerCase(),
        passwordHash,
        email: encryptedEmail,
        stakeUsername: username.toLowerCase(),
        stakePlatform,
        verificationStatus: "unverified",
      }).returning();
      
      // Set session and save explicitly
      (req.session as any).userId = newUser.id;
      
      // Explicitly save session to ensure it persists
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error("[Register] Session save error:", err);
            reject(err);
          } else {
            console.log("[Register] Session saved successfully for user:", newUser.id);
            resolve();
          }
        });
      });
      
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: username,
        details: "User registration successful",
      });
      
      return res.json({
        success: true,
        user: {
          id: newUser.id,
          username: newUser.username,
          verificationStatus: newUser.verificationStatus,
          stakePlatform: newUser.stakePlatform,
        },
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
      }
      console.error("Registration error:", err);
      return res.status(500).json({ message: "Registration failed" });
    }
  });
  
  // Login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const parsed = loginSchema.parse(req.body);
      const { username, password } = parsed;
      
      // Find user
      const [user] = await db.select().from(users).where(eq(users.username, username.toLowerCase()));
      if (!user) {
        logSecurityEvent({
          type: "auth_failure",
          ipHash: hashForLogging(getClientIpForSecurity(req)),
          stakeId: username,
          details: "Login failed - user not found",
        });
        return res.status(401).json({ message: "Invalid username or password" });
      }
      
      // Check if user is deleted
      if (user.deletedAt) {
        logSecurityEvent({
          type: "auth_failure",
          ipHash: hashForLogging(getClientIpForSecurity(req)),
          stakeId: username,
          details: "Login failed - account deleted",
        });
        return res.status(401).json({ message: "This account has been deleted" });
      }
      
      // Verify password
      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        logSecurityEvent({
          type: "auth_failure",
          ipHash: hashForLogging(getClientIpForSecurity(req)),
          stakeId: username,
          details: "Login failed - invalid password",
        });
        return res.status(401).json({ message: "Invalid username or password" });
      }
      
      // Set session and save explicitly
      (req.session as any).userId = user.id;
      
      // Explicitly save session to ensure it persists
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error("[Login] Session save error:", err);
            reject(err);
          } else {
            console.log("[Login] Session saved successfully:", {
              userId: user.id,
              sessionId: req.session.id?.substring(0, 8) + "...",
              sessionStore: typeof req.session.save,
            });
            resolve();
          }
        });
      });
      
      // Debug: Log response headers to verify Set-Cookie is present
      console.log("[Login] Response will be sent. Session ID:", req.session?.id?.substring(0, 8) + "...");
      console.log("[Login] Cookie settings:", {
        secure: req.session.cookie.secure,
        sameSite: req.session.cookie.sameSite,
        httpOnly: req.session.cookie.httpOnly,
        maxAge: req.session.cookie.maxAge,
        domain: req.session.cookie.domain,
        path: req.session.cookie.path,
      });
      
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: username,
        details: "User login successful",
      });
      
      return res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: decrypt(user.email || ""),
          stakeUsername: user.stakeUsername,
          stakePlatform: user.stakePlatform,
          verificationStatus: user.verificationStatus,
          securityDisclaimerAccepted: user.securityDisclaimerAccepted,
        },
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
      }
      console.error("Login error:", err);
      return res.status(500).json({ message: "Login failed" });
    }
  });
  
  // Logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      return res.json({ success: true });
    });
  });
  
  // Get current session
  app.get("/api/auth/session", async (req: Request, res: Response) => {
    // Debug logging for session issues
    const sessionDebug = {
      hasSession: !!req.session,
      sessionId: req.session?.id?.substring(0, 8) + "...",
      hasCookie: !!req.cookies?.["connect.sid"],
      allCookies: Object.keys(req.cookies || {}),
      userId: (req.session as any)?.userId,
      cookieHeader: !!req.headers.cookie,
    };
    
    const userId = (req.session as any)?.userId;
    if (!userId) {
      console.log("[Session Check] No userId found:", sessionDebug);
      return res.json({ user: null });
    }
    
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.json({ user: null });
      }
      
      // Check if user was deleted - invalidate session
      if (user.deletedAt) {
        req.session.destroy(() => {});
        return res.json({ user: null });
      }
      
      return res.json({
        user: {
          id: user.id,
          username: user.username,
          email: decrypt(user.email || ""),
          stakeUsername: user.stakeUsername,
          stakePlatform: user.stakePlatform,
          verificationStatus: user.verificationStatus,
          securityDisclaimerAccepted: user.securityDisclaimerAccepted,
        },
      });
    } catch (err) {
      console.error("Session check error:", err);
      return res.json({ user: null });
    }
  });
  
  // Helper middleware to get current user
  function getCurrentUser(req: Request): string | null {
    return (req.session as any)?.userId || null;
  }
  
  // =================== VERIFICATION WITH IMAGE UPLOAD ===================
  
  // Submit verification request with screenshot
  app.post("/api/verification/submit", upload.single("screenshot"), async (req: Request, res: Response) => {
    // Debug: Log session state for troubleshooting
    console.log("[Verification Submit] Session debug:", {
      hasSession: !!req.session,
      sessionId: req.session?.id,
      userId: (req.session as any)?.userId,
      cookies: Object.keys(req.cookies || {}),
      hasCookie: !!req.cookies?.["connect.sid"],
    });
    
    const userId = getCurrentUser(req);
    if (!userId) {
      console.log("[Verification Submit] Auth failed - no userId in session");
      return res.status(401).json({ message: "Not authenticated" });
    }
    console.log("[Verification Submit] Auth success - userId:", userId);
    
    // Rate limit check
    const rateCheck = checkVerificationRateLimit(userId);
    if (!rateCheck.allowed) {
      logSecurityEvent({
        type: "rate_limit_exceeded",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: userId,
        details: "Verification submission rate limit exceeded",
      });
      return res.status(429).json({ 
        message: "Too many verification requests. Please try again later.",
        retry_after: rateCheck.retryAfter 
      });
    }
    
    try {
      const { stake_username, stake_platform } = req.body;
      const file = req.file;
      
      if (!stake_username || !stake_platform) {
        return res.status(400).json({ message: "Missing required fields: stake_username, stake_platform" });
      }
      
      if (!file) {
        return res.status(400).json({ message: "Screenshot is required" });
      }
      
      if (!["us", "com"].includes(stake_platform)) {
        return res.status(400).json({ message: "stake_platform must be 'us' or 'com'" });
      }
      
      const normalizedUsername = stake_username.toLowerCase().trim();
      const screenshotUrl = `/uploads/verification/${file.filename}`;
      
      // Use a transaction to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Check if this Stake username is already verified by another user
        const [existingVerified] = await tx.select().from(users)
          .where(and(
            eq(users.stakeUsername, normalizedUsername),
            eq(users.verificationStatus, "verified")
          ));
        
        if (existingVerified && existingVerified.id !== userId) {
          throw new Error("STAKE_ALREADY_LINKED");
        }
        
        // Check if user already has a pending verification
        const [existingPending] = await tx.select().from(verificationRequests)
          .where(and(
            eq(verificationRequests.userId, userId),
            eq(verificationRequests.status, "pending")
          ));
        
        if (existingPending) {
          throw new Error("PENDING_EXISTS");
        }
        
        // Create verification request with screenshot
        const [request] = await tx.insert(verificationRequests).values({
          userId,
          stakeUsername: normalizedUsername,
          stakePlatform: stake_platform,
          screenshotUrl,
          screenshotFilename: file.originalname,
        }).returning();
        
        // Update user status to pending
        await tx.update(users).set({
          stakeUsername: normalizedUsername,
          stakePlatform: stake_platform,
          verificationStatus: "pending",
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
        
        return request;
      });
      
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: userId,
        details: `Verification request submitted for ${normalizedUsername}`,
      });
      
      return res.json({
        success: true,
        request_id: result.id,
        message: "Verification request submitted. An admin will review your screenshot shortly."
      });
    } catch (err: any) {
      if (err.message === "STAKE_ALREADY_LINKED") {
        return res.status(400).json({ 
          message: "This Stake username is already linked to another account" 
        });
      }
      if (err.message === "PENDING_EXISTS") {
        return res.status(400).json({ 
          message: "You already have a pending verification request" 
        });
      }
      console.error("Verification submit error:", err);
      return res.status(500).json({ message: "Failed to submit verification request" });
    }
  });
  
  // Serve uploaded files
  const express = await import("express");
  app.use("/uploads", express.default.static(path.join(process.cwd(), "uploads")));
  
  // =================== ADMIN USER VERIFICATION QUEUES ===================
  
  // Get all users by verification status for admin
  app.get("/api/admin/users/verification-status", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        email: users.email,
        stakeUsername: users.stakeUsername,
        stakePlatform: users.stakePlatform,
        verificationStatus: users.verificationStatus,
        verifiedAt: users.verifiedAt,
        createdAt: users.createdAt,
      }).from(users).orderBy(desc(users.createdAt));
      
      // Decrypt emails for admin view
      const decryptedUsers = allUsers.map(u => ({
        ...u,
        email: decrypt(u.email || ""),
      }));
      
      const unverified = decryptedUsers.filter(u => u.verificationStatus === "unverified" || !u.verificationStatus);
      const pending = decryptedUsers.filter(u => u.verificationStatus === "pending");
      const verified = decryptedUsers.filter(u => u.verificationStatus === "verified");
      
      // Get pending verification requests with screenshots
      const pendingRequests = await db.select({
        id: verificationRequests.id,
        userId: verificationRequests.userId,
        stakeUsername: verificationRequests.stakeUsername,
        stakePlatform: verificationRequests.stakePlatform,
        screenshotUrl: verificationRequests.screenshotUrl,
        screenshotFilename: verificationRequests.screenshotFilename,
        createdAt: verificationRequests.createdAt,
        username: users.username,
      })
        .from(verificationRequests)
        .leftJoin(users, eq(verificationRequests.userId, users.id))
        .where(eq(verificationRequests.status, "pending"))
        .orderBy(desc(verificationRequests.createdAt));
      
      return res.json({
        unverified,
        pending,
        verified,
        pendingRequests,
      });
    } catch (err) {
      console.error("Admin users verification status error:", err);
      return res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Check if user can use daily bonus (once every 24 hours)
  async function canUseDailyBonus(stakeId: string): Promise<{ canUse: boolean; nextBonusAt?: Date }> {
    const [state] = await db.select().from(userState).where(eq(userState.stakeId, stakeId));
    if (!state || !state.lastBonusSpinAt) {
      return { canUse: true };
    }
    const nextBonus = new Date(state.lastBonusSpinAt.getTime() + 24 * 60 * 60 * 1000);
    if (Date.now() >= nextBonus.getTime()) {
      return { canUse: true };
    }
    return { canUse: false, nextBonusAt: nextBonus };
  }

  app.post("/api/lookup", async (req: Request, res: Response) => {
    try {
      // Require authentication
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) {
        return res.status(401).json({ message: "Please log in to view your tickets." } as ErrorResponse);
      }

      // Get logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, sessionUserId));
      if (!loggedInUser) {
        return res.status(401).json({ message: "Session invalid. Please log in again." } as ErrorResponse);
      }

      // Check if user is verified
      if (loggedInUser.verificationStatus !== "verified") {
        return res.status(403).json({ 
          message: "Account must be verified to view tickets." 
        } as ErrorResponse);
      }

      // Use logged-in user's stake username - users can only lookup their own data
      const stakeId = loggedInUser.stakeUsername?.toLowerCase();
      if (!stakeId) {
        return res.status(400).json({ message: "No Stake username linked to your account." } as ErrorResponse);
      }

      const domain = (loggedInUser.stakePlatform === "us" ? "us" : "com") as "us" | "com";

      // Check for database override first (for manually added users or testing)
      const override = await getWagerOverride(stakeId);
      
      let lifetimeWagered: number;
      let weightedWager: number;
      let periodLabel = "2026";
      
      // User exists if they have a database override OR are in any Google Sheet
      const hasDbOverride = override !== null;
      
      if (hasDbOverride) {
        // User exists in database - use override values (or 0 if not set)
        lifetimeWagered = override.lifetimeWagered ?? 0;
        weightedWager = override.yearToDateWagered ?? 0;
        console.log(`[Lookup] Using database override for ${stakeId}: lifetime=${lifetimeWagered}, ytd=${weightedWager}`);
      } else {
        // Fall back to Google Sheets data
        const wagerRow = await getWagerRow(stakeId);
        
        // Weighted sheets = 2026 wagers (for ticket calculation)
        // Check both weighted sheets since users might only exist in one
        weightedWager = getWeightedWager(stakeId, domain);
        
        // User must exist in either NGR sheet OR weighted sheets
        if (!wagerRow && weightedWager === 0) {
          // Also check if username exists in weighted sheets with 0 wager
          const existsInWeighted = usernameExistsInSpreadsheet(stakeId, domain);
          if (!existsInWeighted) {
            return res.status(404).json({ message: "Your Stake ID was not found in our records." } as ErrorResponse);
          }
        }
        
        // NGR sheet = lifetime wagered (for display only)
        lifetimeWagered = wagerRow?.wageredAmount ?? 0;
        periodLabel = wagerRow?.periodLabel || "2026";
      }
      
      const ticketsTotal = calculateTickets(weightedWager);
      const ticketsUsed = await countSpinsForStakeId(stakeId);
      const ticketsRemaining = Math.max(0, ticketsTotal - ticketsUsed);
      
      const walletBalance = await getWalletBalance(stakeId);
      const spinBalances = await getSpinBalances(stakeId);
      const pendingWithdrawals = await getPendingWithdrawals(stakeId);
      
      // Check daily bonus availability
      const bonusStatus = await canUseDailyBonus(stakeId);

      const response: LookupResponse = {
        stake_id: stakeId,
        period_label: periodLabel,
        wagered_amount: weightedWager,
        lifetime_wagered: lifetimeWagered,
        tickets_total: ticketsTotal,
        tickets_used: ticketsUsed,
        tickets_remaining: ticketsRemaining,
        wallet_balance: walletBalance,
        spin_balances: spinBalances,
        pending_withdrawals: pendingWithdrawals,
        can_daily_bonus: bonusStatus.canUse,
        next_bonus_at: bonusStatus.nextBonusAt?.toISOString(),
      };

      return res.json(response);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Lookup error:", err);
      const errMsg = err instanceof Error ? err.message : "Internal server error";
      if (errMsg.includes("Unable to parse range") || errMsg.includes("not connected")) {
        return res.status(503).json({ message: "Google Sheet data unavailable. Please check sheet configuration." } as ErrorResponse);
      }
      return res.status(500).json({ message: errMsg } as ErrorResponse);
    }
  });

  app.post("/api/spin", async (req: Request, res: Response) => {
    try {
      // Require login before spinning
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) {
        return res.status(401).json({ message: "Please log in to spin." } as ErrorResponse);
      }

      // Get the logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, sessionUserId));
      if (!loggedInUser) {
        return res.status(401).json({ message: "Session invalid. Please log in again." } as ErrorResponse);
      }

      // Check if user is verified
      if (loggedInUser.verificationStatus !== "verified") {
        return res.status(403).json({ 
          message: "Account must be verified before spinning. Please complete verification first." 
        } as ErrorResponse);
      }

      const clientIp = getClientIp(req);
      const ipHash = hashIp(clientIp);

      if (isRateLimited(ipHash)) {
        return res.status(429).json({ message: "Too many spin attempts. Try again later." } as ErrorResponse);
      }

      // Use the stake username from the logged-in user's account
      const stakeId = loggedInUser.stakeUsername?.toLowerCase();
      if (!stakeId) {
        return res.status(400).json({ message: "No Stake username linked to your account." } as ErrorResponse);
      }

      // Check stake ID rate limit
      if (isStakeIdRateLimited(stakeId)) {
        return res.status(429).json({ message: "Account rate limit exceeded. Please try again later." } as ErrorResponse);
      }

      // Check blacklist - fail closed on error
      const blacklistCheck = await checkUserBlacklist(stakeId);
      if (blacklistCheck.error) {
        return res.status(500).json({ message: blacklistCheck.error } as ErrorResponse);
      }
      if (blacklistCheck.blacklisted) {
        return res.status(403).json({ message: "Account suspended. Contact support." } as ErrorResponse);
      }

      // Get domain from user's registered platform (default to com)
      const domain = (loggedInUser.stakePlatform === "us" ? "us" : "com") as "us" | "com";
      
      // Check for database override first (for testing)
      const override = await getWagerOverride(stakeId);
      let lifetimeWagered = 0;
      let weightedWager = 0;
      
      if (override && (override.lifetimeWagered !== null || override.yearToDateWagered !== null)) {
        // Use override values (for testing)
        lifetimeWagered = override.lifetimeWagered ?? 0;
        weightedWager = override.yearToDateWagered ?? 0;
      } else {
        // Fall back to Google Sheets data
        const wagerRow = await getWagerRow(stakeId);
        if (!wagerRow) {
          return res.status(404).json({ message: "Stake ID not found." } as ErrorResponse);
        }
        lifetimeWagered = wagerRow.wageredAmount;
        weightedWager = getWeightedWager(stakeId, domain);
      }
      
      // Calculate tickets from weighted wager
      const ticketsTotal = calculateTickets(weightedWager);
      const ticketsUsedBefore = await countSpinsForStakeId(stakeId);
      const ticketsRemaining = ticketsTotal - ticketsUsedBefore;

      // Check if user has tickets
      if (ticketsRemaining <= 0) {
        return res.status(403).json({ message: "No tickets remaining." } as ErrorResponse);
      }

      // Use weighted random selection for case prize
      const prize = selectCasePrize(CASE_PRIZES);
      const isWin = prize.value > 0;
      const spinNumber = ticketsUsedBefore + 1;
      const ticketsUsedAfter = spinNumber;
      const ticketsRemainingAfter = ticketsTotal - ticketsUsedAfter;

      // Log spin to database (use lowercase stakeId for consistent counting)
      await db.insert(spinLogs).values({
        stakeId: stakeId,
        wageredAmount: lifetimeWagered,
        spinNumber,
        result: isWin ? "WIN" : "LOSE",
        prizeLabel: prize.label,
        prizeValue: prize.value,
        prizeColor: prize.color,
        isBonus: false,
        ipHash,
      });

      // Add winnings to wallet if won
      let walletBalance = await getWalletBalance(stakeId);
      if (isWin && prize.value > 0) {
        walletBalance = await updateWalletBalance(stakeId, prize.value);
        await db.insert(walletTransactions).values({
          stakeId,
          type: "win",
          amount: prize.value,
          description: `Case opening win: ${prize.label}`,
        });
      }

      const response: SpinResponse = {
        stake_id: stakeId,
        wagered_amount: weightedWager,
        tickets_total: ticketsTotal,
        tickets_used_before: ticketsUsedBefore,
        tickets_used_after: ticketsUsedAfter,
        tickets_remaining_after: ticketsRemainingAfter,
        result: isWin ? "WIN" : "LOSE",
        prize_label: prize.label,
        prize_value: prize.value,
        prize_color: prize.color,
        wallet_balance: walletBalance,
      };

      return res.json(response);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Spin error:", err);
      const errMsg = err instanceof Error ? err.message : "Internal server error";
      if (errMsg.includes("Unable to parse range") || errMsg.includes("not connected")) {
        return res.status(503).json({ message: "Google Sheet data unavailable. Please check sheet configuration." } as ErrorResponse);
      }
      return res.status(500).json({ message: errMsg } as ErrorResponse);
    }
  });

  // Daily bonus spin endpoint (one free spin per 24 hours)
  app.post("/api/spin/bonus", async (req: Request, res: Response) => {
    try {
      // SECURITY: Require authentication
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) {
        return res.status(401).json({ message: "Please log in to claim bonus." } as ErrorResponse);
      }

      // Get the logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, sessionUserId));
      if (!loggedInUser) {
        return res.status(401).json({ message: "Session invalid. Please log in again." } as ErrorResponse);
      }

      // Check if user is verified
      if (loggedInUser.verificationStatus !== "verified") {
        return res.status(403).json({ 
          message: "Account must be verified before claiming bonus." 
        } as ErrorResponse);
      }

      // SECURITY: Use the authenticated user's stake ID, not the one from request body
      const stakeId = loggedInUser.stakeUsername?.toLowerCase();
      if (!stakeId) {
        return res.status(400).json({ message: "No Stake username linked to your account." } as ErrorResponse);
      }
      
      const ipHash = hashIp(getClientIp(req));

      // Check blacklist - fail closed on error
      const blacklistCheck = await checkUserBlacklist(stakeId);
      if (blacklistCheck.error) {
        return res.status(500).json({ message: blacklistCheck.error } as ErrorResponse);
      }
      if (blacklistCheck.blacklisted) {
        return res.status(403).json({ message: "Account suspended. Contact support." } as ErrorResponse);
      }

      // Check for database override first (for manually added users)
      const override = await getWagerOverride(stakeId);
      let wageredAmount = 0;
      
      if (override && (override.lifetimeWagered !== null || override.yearToDateWagered !== null)) {
        // Use override values (for testing/manual users)
        wageredAmount = override.yearToDateWagered ?? override.lifetimeWagered ?? 0;
      } else {
        // Fall back to Google Sheets data
        const wagerRow = await getWagerRow(stakeId);
        if (!wagerRow) {
          return res.status(404).json({ message: "Stake ID not found in wagering data" } as ErrorResponse);
        }
        wageredAmount = wagerRow.wageredAmount;
      }

      // Get or create user state
      let [state] = await db.select().from(userState).where(eq(userState.stakeId, stakeId));
      
      if (!state) {
        await db.insert(userState).values({ stakeId });
        [state] = await db.select().from(userState).where(eq(userState.stakeId, stakeId));
      }

      // Check cooldown (24 hours)
      const now = new Date();
      const cooldownMs = 24 * 60 * 60 * 1000; // 24 hours
      
      if (state.lastBonusSpinAt) {
        const timeSince = now.getTime() - state.lastBonusSpinAt.getTime();
        if (timeSince < cooldownMs) {
          const remainingMs = cooldownMs - timeSince;
          const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
          
          // Log denied bonus attempt
          await db.insert(rateLimitLogs).values({
            ipHash,
            stakeId,
            action: "bonus_denied",
          });
          
          return res.status(429).json({ 
            message: `Daily bonus already claimed. Try again in ${remainingHours} hours.`,
            remaining_ms: remainingMs,
            next_bonus_at: new Date(state.lastBonusSpinAt.getTime() + cooldownMs).toISOString(),
          } as ErrorResponse);
        }
      }

      // Daily bonus has 1/500 chance to win $5
      const DAILY_BONUS_WIN_CHANCE = 1 / 500; // 0.2% chance
      const DAILY_BONUS_PRIZE = 5; // $5 prize
      
      const random = Math.random();
      const isWin = random < DAILY_BONUS_WIN_CHANCE;
      const prize = {
        value: isWin ? DAILY_BONUS_PRIZE : 0,
        label: isWin ? "$5" : "$0",
        color: isWin ? "green" as const : "grey" as const,
      };

      // Update last bonus spin time
      await db.update(userState).set({ 
        lastBonusSpinAt: now,
        updatedAt: now,
      }).where(eq(userState.stakeId, stakeId));

      // Log the bonus spin
      const spinsForUser = await db.select({ count: sql<number>`count(*)` })
        .from(spinLogs).where(eq(spinLogs.stakeId, stakeId));
      const spinNumber = Number(spinsForUser[0]?.count || 0) + 1;

      await db.insert(spinLogs).values({
        stakeId,
        wageredAmount,
        spinNumber,
        result: isWin ? "WIN" : "LOSE",
        prizeLabel: `[BONUS] ${prize.label}`,
        prizeValue: prize.value,
        prizeColor: prize.color,
        isBonus: true,
        ipHash,
      });

      // Add winnings to wallet if won
      let walletBalance = await getWalletBalance(stakeId);
      if (isWin && prize.value > 0) {
        walletBalance = await updateWalletBalance(stakeId, prize.value);
        await db.insert(walletTransactions).values({
          stakeId,
          type: "win",
          amount: prize.value,
          description: `Daily bonus win: ${prize.label}`,
        });
      }

      return res.json({
        stake_id: stakeId,
        result: isWin ? "WIN" : "LOSE",
        prize_label: prize.label,
        prize_value: prize.value,
        prize_color: prize.color,
        wallet_balance: walletBalance,
        is_bonus: true,
        next_bonus_at: new Date(now.getTime() + cooldownMs).toISOString(),
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Bonus spin error:", err);
      const errMsg = err instanceof Error ? err.message : "Internal server error";
      if (errMsg.includes("Unable to parse range") || errMsg.includes("not connected")) {
        return res.status(503).json({ message: "Google Sheet data unavailable. Please check sheet configuration." } as ErrorResponse);
      }
      return res.status(500).json({ message: errMsg } as ErrorResponse);
    }
  });

  // Check bonus spin availability
  app.post("/api/spin/bonus/check", async (req: Request, res: Response) => {
    try {
      // SECURITY: Require authentication
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) {
        return res.status(401).json({ message: "Please log in to check bonus status." } as ErrorResponse);
      }

      // Get the logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, sessionUserId));
      if (!loggedInUser) {
        return res.status(401).json({ message: "Session invalid. Please log in again." } as ErrorResponse);
      }

      // SECURITY: Use the authenticated user's stake ID
      const stakeId = loggedInUser.stakeUsername?.toLowerCase();
      if (!stakeId) {
        return res.status(400).json({ message: "No Stake username linked to your account." } as ErrorResponse);
      }

      const [state] = await db.select().from(userState).where(eq(userState.stakeId, stakeId));
      
      const cooldownMs = 24 * 60 * 60 * 1000;
      const now = new Date();
      
      if (!state || !state.lastBonusSpinAt) {
        return res.json({ available: true, remaining_ms: 0 });
      }

      const timeSince = now.getTime() - state.lastBonusSpinAt.getTime();
      const available = timeSince >= cooldownMs;
      const remainingMs = available ? 0 : cooldownMs - timeSince;

      return res.json({
        available,
        remaining_ms: remainingMs,
        next_bonus_at: available ? null : new Date(state.lastBonusSpinAt.getTime() + cooldownMs).toISOString(),
      });
    } catch (err) {
      console.error("Bonus check error:", err);
      return res.status(500).json({ message: "Internal server error" } as ErrorResponse);
    }
  });

  app.get("/api/admin/logs", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const logs = await db.select().from(spinLogs).orderBy(desc(spinLogs.timestamp)).limit(100);
      const totalCount = await db.select({ count: sql<number>`count(*)` }).from(spinLogs);
      const winCount = await db.select({ count: sql<number>`count(*)` }).from(spinLogs).where(eq(spinLogs.result, "WIN"));
      
      const formattedLogs = logs.map(log => ({
        timestamp: log.timestamp.toISOString(),
        stakeId: log.stakeId,
        wageredAmount: log.wageredAmount,
        spinNumber: log.spinNumber,
        result: log.result as "WIN" | "LOSE",
        prizeLabel: log.prizeLabel,
        isBonus: log.isBonus,
      }));

      return res.json({
        logs: formattedLogs,
        totalSpins: Number(totalCount[0]?.count || 0),
        totalWins: Number(winCount[0]?.count || 0),
      });
    } catch (err) {
      console.error("Admin logs error:", err);
      return res.status(500).json({ message: "Failed to fetch logs" });
    }
  });


  // Request withdrawal to Stake account - REQUIRES AUTHENTICATION
  app.post("/api/wallet/withdraw", async (req: Request, res: Response) => {
    try {
      // SECURITY: Require authentication
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) {
        return res.status(401).json({ message: "Authentication required" } as ErrorResponse);
      }

      // Get logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, sessionUserId));
      if (!loggedInUser) {
        return res.status(401).json({ message: "Session invalid. Please log in again." } as ErrorResponse);
      }

      // Check if user is verified
      if (loggedInUser.verificationStatus !== "verified") {
        return res.status(403).json({ 
          message: "Account must be verified to request withdrawals." 
        } as ErrorResponse);
      }

      const parsed = withdrawRequestSchema.parse(req.body);
      const { amount } = parsed;
      
      // SECURITY: Always use the authenticated user's stake ID from the database
      // The request body no longer accepts stake_id to prevent impersonation attacks
      const stakeId = loggedInUser.stakeUsername?.toLowerCase();
      if (!stakeId) {
        return res.status(400).json({ message: "No Stake username linked to your account." } as ErrorResponse);
      }

      // Check blacklist - fail closed on error
      const blacklistCheck = await checkUserBlacklist(stakeId);
      if (blacklistCheck.error) {
        return res.status(500).json({ message: blacklistCheck.error } as ErrorResponse);
      }
      if (blacklistCheck.blacklisted) {
        return res.status(403).json({ message: "Account suspended. Contact support." } as ErrorResponse);
      }

      const walletBalance = await getWalletBalance(stakeId);
      const pendingWithdrawals = await getPendingWithdrawals(stakeId);
      const availableBalance = walletBalance - pendingWithdrawals;

      if (availableBalance < amount) {
        return res.status(400).json({ 
          message: `Not enough available funds. Available: $${availableBalance}` 
        } as ErrorResponse);
      }

      // Create withdrawal request (pending = just a hold, not deducted yet)
      const [request] = await db.insert(withdrawalRequests).values({
        stakeId,
        amount,
        status: "pending",
      }).returning();

      // Log security event
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId,
        details: `Withdrawal request of $${amount} submitted`,
      });

      // Don't log transaction yet - it's just a hold until approved
      const newPending = await getPendingWithdrawals(stakeId);

      const response: WithdrawResponse = {
        success: true,
        request_id: request.id,
        amount,
        wallet_balance: walletBalance,
        pending_withdrawals: newPending,
      };

      return res.json(response);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Withdraw error:", err);
      return res.status(500).json({ message: "Internal server error" } as ErrorResponse);
    }
  });

  // Admin: Get all withdrawal requests
  app.get("/api/admin/withdrawals", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const requests = await db.select().from(withdrawalRequests).orderBy(desc(withdrawalRequests.createdAt)).limit(100);
      return res.json({ withdrawals: requests });
    } catch (err) {
      console.error("Admin withdrawals error:", err);
      return res.status(500).json({ message: "Failed to fetch withdrawals" });
    }
  });

  // Admin: Process withdrawal request
  app.post("/api/admin/withdrawals/process", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const parsed = processWithdrawalSchema.parse(req.body);
      const { id, status, admin_notes } = parsed;

      const [existing] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id));
      if (!existing) {
        return res.status(404).json({ message: "Withdrawal request not found" } as ErrorResponse);
      }
      if (existing.status !== "pending") {
        return res.status(400).json({ message: "Withdrawal already processed" } as ErrorResponse);
      }

      // Update request
      await db.update(withdrawalRequests)
        .set({ status, processedAt: new Date(), adminNotes: admin_notes || null })
        .where(eq(withdrawalRequests.id, id));

      // When approved, deduct wallet balance (pending was just a hold)
      // When rejected, funds stay in wallet (no change needed since pending was just a hold)
      if (status === "approved") {
        // Deduct from actual wallet balance when approved
        await updateWalletBalance(existing.stakeId, -existing.amount);
        await db.insert(walletTransactions).values({
          stakeId: existing.stakeId,
          type: "withdrawal",
          amount: -existing.amount,
          description: `Approved withdrawal #${id} - sent to Stake account`,
        });
      }
      // Note: For rejected, the pending amount is released automatically by not counting it anymore

      return res.json({ success: true, id, status });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Process withdrawal error:", err);
      return res.status(500).json({ message: "Internal server error" } as ErrorResponse);
    }
  });

  app.get("/api/config", (_req: Request, res: Response) => {
    return res.json({
      configured: true,
      siteName: config.siteName,
      prizeLabel: config.prizeLabel,
      casePrizes: CASE_PRIZES,
    });
  });

  // Health check endpoint to verify database connectivity
  app.get("/api/health", async (_req: Request, res: Response) => {
    try {
      // Test database connection by checking if admin_sessions table exists
      const result = await db.execute(sql`SELECT COUNT(*) as count FROM admin_sessions`);
      return res.json({ 
        status: "healthy", 
        database: "connected",
        admin_sessions_table: "exists",
        env: process.env.NODE_ENV || "unknown"
      });
    } catch (err: any) {
      return res.json({ 
        status: "unhealthy", 
        database: "error",
        error: err?.message,
        hint: "Run 'npm run db:push' in production shell to create tables"
      });
    }
  });

  // =================== ADMIN AUTHENTICATION ===================
  const adminLoginSchema = z.object({
    password: z.string().min(1),
  });

  app.post("/api/admin/login", async (req: Request, res: Response) => {
    const clientIp = getClientIpForSecurity(req);
    const ipHash = hashForLogging(clientIp);
    
    // Brute force protection - 5 attempts per 15 minutes
    if (isAdminLoginRateLimited(ipHash)) {
      const lockoutMs = getAdminLoginLockoutMs(ipHash);
      const lockoutMinutes = Math.ceil(lockoutMs / 60000);
      logSecurityEvent({
        type: "rate_limit_exceeded",
        ipHash,
        details: `Admin login rate limit exceeded. Locked for ${lockoutMinutes} minutes`,
      });
      return res.status(429).json({ 
        message: `Too many login attempts. Try again in ${lockoutMinutes} minutes.` 
      });
    }
    
    try {
      const { password } = adminLoginSchema.parse(req.body);
      const adminPassword = process.env.ADMIN_PASSWORD;
      
      if (!adminPassword) {
        return res.status(500).json({ message: "Admin password not configured" });
      }
      
      // Use timing-safe comparison to prevent timing attacks
      const passwordBuffer = Buffer.from(password);
      const adminPasswordBuffer = Buffer.from(adminPassword);
      
      if (passwordBuffer.length !== adminPasswordBuffer.length || 
          !crypto.timingSafeEqual(passwordBuffer, adminPasswordBuffer)) {
        logSecurityEvent({
          type: "auth_failure",
          ipHash,
          details: "Invalid admin password attempt",
        });
        return res.status(401).json({ message: "Invalid password" });
      }

      // Generate new session token (regenerate on login for session fixation protection)
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + SESSION_CONFIG.ABSOLUTE_TIMEOUT_MS);
      const lastActivityAt = new Date();

      try {
        // Clean up any existing sessions for this IP (optional: prevents session accumulation)
        await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
        
        await db.insert(adminSessions).values({ 
          sessionToken, 
          expiresAt,
          lastActivityAt,
        });
      } catch (dbErr: any) {
        console.error("Database error during login:", dbErr);
        return res.status(500).json({ 
          message: "Database error - tables may not exist. Run 'npm run db:push' in production shell.",
        });
      }
      
      // Set secure cookie with strict settings
      res.cookie(SESSION_CONFIG.COOKIE_NAME, sessionToken, {
        ...SESSION_CONFIG.COOKIE_OPTIONS,
        expires: expiresAt,
      });

      // Generate CSRF token for admin session
      const csrfToken = generateCSRFToken(sessionToken);
      
      // Reset brute force counter on successful login
      resetAdminLoginAttempts(ipHash);
      
      logSecurityEvent({
        type: "auth_success",
        ipHash,
        details: "Admin login successful",
      });

      return res.json({ success: true, csrf_token: csrfToken });
    } catch (err: any) {
      console.error("Admin login error:", err);
      logSecurityEvent({
        type: "auth_failure",
        ipHash,
        details: `Login error: ${err?.message || "unknown"}`,
      });
      return res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/admin/logout", async (req: Request, res: Response) => {
    const sessionToken = req.cookies?.[SESSION_CONFIG.COOKIE_NAME];
    const clientIp = getClientIpForSecurity(req);
    const ipHash = hashForLogging(clientIp);
    
    if (sessionToken) {
      // Invalidate session server-side
      await db.delete(adminSessions).where(eq(adminSessions.sessionToken, sessionToken));
      
      logSecurityEvent({
        type: "session_invalidated",
        ipHash,
        details: "Admin logout",
      });
    }
    
    // Clear cookie with same settings used to set it
    res.clearCookie(SESSION_CONFIG.COOKIE_NAME, {
      ...SESSION_CONFIG.COOKIE_OPTIONS,
    });
    
    return res.json({ success: true });
  });

  async function verifyAdminSession(req: Request): Promise<boolean> {
    const sessionToken = req.cookies?.[SESSION_CONFIG.COOKIE_NAME];
    if (!sessionToken) return false;
    
    const [session] = await db.select().from(adminSessions)
      .where(and(
        eq(adminSessions.sessionToken, sessionToken), 
        gte(adminSessions.expiresAt, new Date())
      ));
    
    if (!session) return false;
    
    // Check inactivity timeout (30 minutes)
    if (session.lastActivityAt) {
      const inactiveMs = Date.now() - session.lastActivityAt.getTime();
      if (inactiveMs > SESSION_CONFIG.MAX_AGE_MS) {
        // Session expired due to inactivity - clean it up
        await db.delete(adminSessions).where(eq(adminSessions.sessionToken, sessionToken));
        return false;
      }
    }
    
    // Update last activity time (sliding window)
    await db.update(adminSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(adminSessions.sessionToken, sessionToken));
    
    return true;
  }

  app.get("/api/admin/verify", async (req: Request, res: Response) => {
    const isValid = await verifyAdminSession(req);
    return res.json({ authenticated: isValid });
  });

  // Middleware helper with security logging
  async function requireAdmin(req: Request, res: Response): Promise<boolean> {
    const isValid = await verifyAdminSession(req);
    if (!isValid) {
      const clientIp = getClientIpForSecurity(req);
      const ipHash = hashForLogging(clientIp);
      
      logSecurityEvent({
        type: "access_denied",
        ipHash,
        details: `Unauthorized admin access attempt: ${req.method} ${req.path}`,
      });
      
      res.status(401).json({ message: "Admin authentication required" });
      return false;
    }
    return true;
  }

  // Security events endpoint for admin monitoring
  app.get("/api/admin/security-events", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const events = getRecentSecurityEvents(100);
    return res.json({ events });
  });

  // =================== DATA STATUS PANEL ===================
  app.get("/api/admin/data-status", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const cacheStatus = getCacheStatus();
    const weightedStatus = getWeightedCacheStatus();
    const allData = getAllWagerData();
    
    // Find duplicates
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const row of allData) {
      const normalized = row.stakeId.toLowerCase();
      if (seen.has(normalized)) {
        duplicates.push(row.stakeId);
      }
      seen.add(normalized);
    }

    return res.json({
      sheetConfigured: !!config.googleSheetsId,
      tabName: config.wagerSheetName,
      ...cacheStatus,
      duplicateCount: duplicates.length,
      duplicates: duplicates.slice(0, 20),
      weightedSheets: {
        us: {
          configured: !!config.weightedSheetsUs,
          tabName: config.weightedSheetName,
          loaded: weightedStatus.usLoaded,
          rowCount: weightedStatus.usRowCount,
        },
        com: {
          configured: !!config.weightedSheetsCom,
          tabName: config.weightedSheetName,
          loaded: weightedStatus.comLoaded,
          rowCount: weightedStatus.comRowCount,
        },
        lastRefresh: weightedStatus.lastRefresh?.toISOString() || null,
      },
    });
  });

  app.post("/api/admin/refresh-cache", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const result = await refreshCache();
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ message: err.message || "Failed to refresh cache" });
    }
  });

  // =================== ALL USERS ===================
  app.get("/api/admin/users", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const search = (req.query.search as string || "").toLowerCase().trim();
    
    const allUsers = await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      stakeUsername: users.stakeUsername,
      stakePlatform: users.stakePlatform,
      verificationStatus: users.verificationStatus,
      createdAt: users.createdAt,
      verifiedAt: users.verifiedAt,
    }).from(users).orderBy(users.createdAt);
    
    // Decrypt emails for admin view
    const decryptedUsers = allUsers.map(u => ({
      ...u,
      email: decrypt(u.email || ""),
    }));
    
    const filteredUsers = search 
      ? decryptedUsers.filter(u => 
          u.username?.toLowerCase().includes(search) ||
          u.email?.toLowerCase().includes(search) ||
          u.stakeUsername?.toLowerCase().includes(search)
        )
      : decryptedUsers;
    
    return res.json({ users: filteredUsers, total: allUsers.length });
  });

  // =================== WEIGHTED SPREADSHEET DATA ===================
  app.get("/api/admin/spreadsheet/:domain", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const domain = req.params.domain as "us" | "com";
    if (!["us", "com"].includes(domain)) {
      return res.status(400).json({ message: "Invalid domain. Must be 'us' or 'com'" });
    }
    
    const search = (req.query.search as string || "").toLowerCase().trim();
    const { getAllWeightedUsers } = await import("./lib/sheets");
    
    const allData = getAllWeightedUsers(domain);
    const filteredData = search 
      ? allData.filter(u => u.stakeId.toLowerCase().includes(search))
      : allData;
    
    return res.json({
      domain,
      users: filteredData,
      total: allData.length,
      platformLabel: domain === "us" ? "Stake.us" : "Stake.com",
    });
  });

  // =================== USER FLAGS (BLACKLIST/ALLOWLIST/DISPUTED) ===================
  const userFlagSchema = z.object({
    stakeId: z.string().min(1),
    isBlacklisted: z.boolean().optional(),
    isAllowlisted: z.boolean().optional(),
    isDisputed: z.boolean().optional(),
    notes: z.string().optional(),
  });

  app.get("/api/admin/user-flags", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const flags = await db.select().from(userFlags).orderBy(desc(userFlags.updatedAt));
    return res.json({ flags });
  });

  app.post("/api/admin/user-flags", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const data = userFlagSchema.parse(req.body);
      const stakeId = data.stakeId.toLowerCase();
      
      const [existing] = await db.select().from(userFlags).where(eq(userFlags.stakeId, stakeId));
      
      if (existing) {
        await db.update(userFlags).set({
          isBlacklisted: data.isBlacklisted ?? existing.isBlacklisted,
          isAllowlisted: data.isAllowlisted ?? existing.isAllowlisted,
          isDisputed: data.isDisputed ?? existing.isDisputed,
          notes: data.notes ?? existing.notes,
          updatedAt: new Date(),
        }).where(eq(userFlags.stakeId, stakeId));
      } else {
        await db.insert(userFlags).values({
          stakeId,
          isBlacklisted: data.isBlacklisted ?? false,
          isAllowlisted: data.isAllowlisted ?? false,
          isDisputed: data.isDisputed ?? false,
          notes: data.notes ?? null,
        });
      }
      
      return res.json({ success: true });
    } catch (err) {
      console.error("User flag error:", err);
      return res.status(400).json({ message: "Invalid request" });
    }
  });

  app.delete("/api/admin/user-flags/:stakeId", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const stakeId = req.params.stakeId.toLowerCase();
    await db.delete(userFlags).where(eq(userFlags.stakeId, stakeId));
    return res.json({ success: true });
  });

  // =================== WAGER OVERRIDES (TESTING) ===================
  // Get wager override for a user
  app.get("/api/admin/wager-override/:stakeId", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const stakeId = req.params.stakeId.toLowerCase();
    const [override] = await db.select().from(wagerOverrides).where(eq(wagerOverrides.stakeId, stakeId));
    return res.json({ override: override || null });
  });

  // Set wager override for a user (for testing)
  app.post("/api/admin/wager-override", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { stakeId, lifetimeWagered, yearToDateWagered, note } = req.body;
      
      if (!stakeId) {
        return res.status(400).json({ message: "stakeId is required" });
      }
      
      const normalizedStakeId = stakeId.toLowerCase();
      
      // Upsert override
      const [existing] = await db.select().from(wagerOverrides).where(eq(wagerOverrides.stakeId, normalizedStakeId));
      
      if (existing) {
        await db.update(wagerOverrides)
          .set({
            lifetimeWagered: lifetimeWagered ?? existing.lifetimeWagered,
            yearToDateWagered: yearToDateWagered ?? existing.yearToDateWagered,
            note: note ?? existing.note,
            updatedAt: new Date(),
          })
          .where(eq(wagerOverrides.stakeId, normalizedStakeId));
      } else {
        await db.insert(wagerOverrides).values({
          stakeId: normalizedStakeId,
          lifetimeWagered,
          yearToDateWagered,
          note,
        });
      }
      
      console.log(`[Admin] Set wager override for ${normalizedStakeId}: lifetime=${lifetimeWagered}, ytd=${yearToDateWagered}`);
      return res.json({ success: true });
    } catch (err) {
      console.error("Wager override error:", err);
      return res.status(400).json({ message: "Invalid request" });
    }
  });

  // Delete wager override for a user
  app.delete("/api/admin/wager-override/:stakeId", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const stakeId = req.params.stakeId.toLowerCase();
    await db.delete(wagerOverrides).where(eq(wagerOverrides.stakeId, stakeId));
    console.log(`[Admin] Deleted wager override for ${stakeId}`);
    return res.json({ success: true });
  });

  // List all wager overrides
  app.get("/api/admin/wager-overrides", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const overrides = await db.select().from(wagerOverrides).orderBy(desc(wagerOverrides.updatedAt));
    return res.json({ overrides });
  });

  // Check if allowlist mode is enabled
  app.get("/api/admin/allowlist-mode", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const [toggle] = await db.select().from(featureToggles).where(eq(featureToggles.key, "ALLOWLIST_MODE_ENABLED"));
    return res.json({ enabled: toggle?.value === "true" });
  });

  // =================== USER LOOKUP TOOL ===================
  app.get("/api/admin/user-lookup/:stakeId", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const stakeId = req.params.stakeId.toLowerCase();
    
    // Check for wager override first (for testing)
    const override = await getWagerOverride(stakeId);
    
    // Get wager data from NGR sheet (lifetime data)
    const ngrData = await getWagerRow(stakeId);
    
    // Get wager data from weighted sheets (2026 data)
    const weightedData = getWeightedWagerWithDomain(stakeId);
    
    const cacheStatus = getCacheStatus();
    
    // Determine values - override takes precedence, then sheet data
    let lifetimeWagered: number | null = null;
    let yearToDateWagered: number | null = null;
    let platform: string | null = null;
    let usingOverride = false;
    
    if (override) {
      usingOverride = true;
      lifetimeWagered = override.lifetimeWagered;
      yearToDateWagered = override.yearToDateWagered;
      platform = "Override (Test Data)";
    } else {
      // NGR sheet = lifetime wagered
      if (ngrData) {
        lifetimeWagered = ngrData.wageredAmount;
      }
      // Weighted sheets = 2026 YTD wagered
      if (weightedData.wager > 0) {
        yearToDateWagered = weightedData.wager;
        platform = weightedData.domain === "us" ? "Stake.us" : "Stake.com";
      }
    }
    
    // User is found if they have data in any source
    const found = lifetimeWagered !== null || yearToDateWagered !== null;
    
    // Tickets are calculated from 2026 YTD wagered amount
    const ticketSource = yearToDateWagered ?? 0;
    
    // Get local stats from database
    const spins = await db.select().from(spinLogs).where(eq(spinLogs.stakeId, stakeId)).orderBy(desc(spinLogs.timestamp));
    const [wallet] = await db.select().from(userWallets).where(eq(userWallets.stakeId, stakeId));
    const spinBalances = await getSpinBalances(stakeId);
    const [flagData] = await db.select().from(userFlags).where(eq(userFlags.stakeId, stakeId));
    const transactions = await db.select().from(walletTransactions).where(eq(walletTransactions.stakeId, stakeId)).orderBy(desc(walletTransactions.createdAt)).limit(20);
    
    // Get registered user account if exists
    const [registeredUser] = await db.select({
      id: users.id,
      username: users.username,
      verificationStatus: users.verificationStatus,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    }).from(users).where(eq(users.stakeUsername, stakeId));
    
    const winCount = spins.filter(s => s.result === "WIN").length;
    const lastSpin = spins[0];

    return res.json({
      found,
      stakeId,
      lifetimeWagered,
      yearToDateWagered,
      platform,
      usingOverride,
      sheetLastUpdated: cacheStatus.lastFetchTime,
      computedTickets: calculateTickets(ticketSource),
      localStats: {
        totalSpins: spins.length,
        wins: winCount,
        lastSpinTime: lastSpin?.timestamp || null,
        walletBalance: wallet?.balance || 0,
        spinBalances,
      },
      flags: flagData || null,
      recentTransactions: transactions,
      registeredUser: registeredUser ? {
        id: registeredUser.id,
        username: registeredUser.username,
        verificationStatus: registeredUser.verificationStatus,
        createdAt: registeredUser.createdAt,
        isDeleted: registeredUser.deletedAt !== null,
      } : null,
    });
  });

  // =================== RATE LIMIT & ABUSE MONITORING ===================
  app.get("/api/admin/rate-stats", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Spins in last hour
    const spinsLastHour = await db.select({ count: sql<number>`count(*)` })
      .from(spinLogs).where(gte(spinLogs.timestamp, oneHourAgo));
    
    // Rate limit logs (bonus denials, etc)
    const denials = await db.select().from(rateLimitLogs)
      .where(and(eq(rateLimitLogs.action, "bonus_denied"), gte(rateLimitLogs.createdAt, oneHourAgo)));
    
    // Top 20 stake IDs by spin attempts (last hour)
    const topSpinners = await db.select({
      stakeId: spinLogs.stakeId,
      count: sql<number>`count(*)`,
    }).from(spinLogs).where(gte(spinLogs.timestamp, oneHourAgo))
      .groupBy(spinLogs.stakeId).orderBy(desc(sql`count(*)`)).limit(20);
    
    // IP-based anomalies: same IP, multiple stake IDs
    const ipAnomalies = await db.select({
      ipHash: spinLogs.ipHash,
      stakeIds: sql<string>`string_agg(DISTINCT stake_id, ', ')`,
      idCount: sql<number>`count(DISTINCT stake_id)`,
    }).from(spinLogs).where(gte(spinLogs.timestamp, oneHourAgo))
      .groupBy(spinLogs.ipHash)
      .having(sql`count(DISTINCT stake_id) > 1`)
      .orderBy(desc(sql`count(DISTINCT stake_id)`)).limit(20);

    return res.json({
      spinsLastHour: Number(spinsLastHour[0]?.count || 0),
      bonusDenials: denials.length,
      topSpinners,
      ipAnomalies,
    });
  });

  // =================== FEATURE TOGGLES ===================
  app.get("/api/admin/toggles", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const toggles = await db.select().from(featureToggles);
    
    // Default toggles if not set
    const defaults: Record<string, { value: string; description: string }> = {
      WIN_PROBABILITY_BRONZE: { value: "0.01", description: "Bronze spin win probability" },
      WIN_PROBABILITY_SILVER: { value: "0.004", description: "Silver spin win probability" },
      WIN_PROBABILITY_GOLD: { value: "0.005", description: "Gold spin win probability" },
      SHOW_RECENT_WINS: { value: "true", description: "Show recent wins on homepage" },
      TICKET_UNIT_WAGER: { value: "1000", description: "Wager amount per ticket" },
      SPINS_ENABLED: { value: "true", description: "Enable/disable spins globally" },
      RAFFLE_EXPORT_ENABLED: { value: "true", description: "Enable/disable raffle export" },
      ALLOWLIST_MODE_ENABLED: { value: "false", description: "Only allowlisted users can spin" },
    };
    
    const result: Record<string, any> = {};
    for (const [key, def] of Object.entries(defaults)) {
      const found = toggles.find(t => t.key === key);
      result[key] = { value: found?.value ?? def.value, description: def.description };
    }
    
    return res.json({ toggles: result });
  });

  const toggleUpdateSchema = z.object({
    key: z.string().min(1),
    value: z.string(),
  });

  app.post("/api/admin/toggles", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { key, value } = toggleUpdateSchema.parse(req.body);
      const [existing] = await db.select().from(featureToggles).where(eq(featureToggles.key, key));
      
      if (existing) {
        await db.update(featureToggles).set({ value, updatedAt: new Date() }).where(eq(featureToggles.key, key));
      } else {
        await db.insert(featureToggles).values({ key, value });
      }
      
      return res.json({ success: true });
    } catch (err) {
      return res.status(400).json({ message: "Invalid request" });
    }
  });

  // =================== PAYOUTS ===================
  const payoutSchema = z.object({
    stakeId: z.string().min(1),
    amount: z.number().positive(),
    prize: z.string().optional(),
    notes: z.string().optional(),
  });

  app.get("/api/admin/payouts", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const allPayouts = await db.select().from(payouts).orderBy(desc(payouts.createdAt));
    return res.json({ payouts: allPayouts });
  });

  app.post("/api/admin/payouts", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const data = payoutSchema.parse(req.body);
      await db.insert(payouts).values({
        stakeId: data.stakeId.toLowerCase(),
        amount: data.amount,
        prize: data.prize || null,
        notes: data.notes || null,
        status: "pending",
      });
      return res.json({ success: true });
    } catch (err) {
      return res.status(400).json({ message: "Invalid request" });
    }
  });

  const payoutUpdateSchema = z.object({
    id: z.number().positive(),
    status: z.enum(["pending", "sent", "failed"]),
    transactionHash: z.string().optional(),
    notes: z.string().optional(),
  });

  app.patch("/api/admin/payouts", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { id, status, transactionHash, notes } = payoutUpdateSchema.parse(req.body);
      await db.update(payouts).set({
        status,
        transactionHash: transactionHash || null,
        notes: notes || null,
        processedAt: status !== "pending" ? new Date() : null,
      }).where(eq(payouts.id, id));
      return res.json({ success: true });
    } catch (err) {
      return res.status(400).json({ message: "Invalid request" });
    }
  });

  // Bulk upload payouts from CSV
  const bulkPayoutsSchema = z.object({
    payouts: z.array(z.object({
      stakeId: z.string(),
      amount: z.number().positive(),
      prize: z.string().optional(),
    })),
  });

  app.post("/api/admin/payouts/bulk", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { payouts: payoutList } = bulkPayoutsSchema.parse(req.body);
      for (const p of payoutList) {
        await db.insert(payouts).values({
          stakeId: p.stakeId.toLowerCase(),
          amount: p.amount,
          prize: p.prize || null,
          status: "pending",
        });
      }
      return res.json({ success: true, count: payoutList.length });
    } catch (err) {
      return res.status(400).json({ message: "Invalid request" });
    }
  });

  // =================== RAFFLE EXPORT WITH AUDIT ===================

  const exportSchema = z.object({
    campaign: z.string().min(1),
    weekLabel: z.string().min(1),
    ticketUnit: z.number().positive().default(1000),
    wagerField: z.enum(["Wagered_Weekly", "Wagered_Monthly", "Wagered_Overall"]).default("Wagered_Weekly"),
  });

  app.post("/api/admin/export/preview", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const params = exportSchema.parse(req.body);
      const allData = getAllWagerData();
      const flaggedUsers = await db.select().from(userFlags);
      const blacklist = new Set(flaggedUsers.filter(f => f.isBlacklisted).map(f => f.stakeId));
      const disputed = new Set(flaggedUsers.filter(f => f.isDisputed).map(f => f.stakeId));
      
      // Check allowlist mode
      const [allowlistToggle] = await db.select().from(featureToggles).where(eq(featureToggles.key, "ALLOWLIST_MODE_ENABLED"));
      const allowlistMode = allowlistToggle?.value === "true";
      const allowlist = new Set(flaggedUsers.filter(f => f.isAllowlisted).map(f => f.stakeId));
      
      const entries: { stakeId: string; wager: number; tickets: number; status: string }[] = [];
      let totalTickets = 0;
      let eligibleUsers = 0;
      let wagers: number[] = [];
      
      for (const row of allData) {
        const normalizedId = row.stakeId.toLowerCase();
        let status = "ok";
        
        if (blacklist.has(normalizedId)) {
          status = "blacklisted";
        } else if (disputed.has(normalizedId)) {
          status = "disputed";
        } else if (allowlistMode && !allowlist.has(normalizedId)) {
          status = "not_allowlisted";
        } else if (row.wageredAmount <= 0) {
          status = "zero_wager";
        }
        
        const tickets = Math.floor(row.wageredAmount / params.ticketUnit);
        
        if (status === "ok" && tickets > 0) {
          eligibleUsers++;
          totalTickets += tickets;
          wagers.push(row.wageredAmount);
        }
        
        entries.push({
          stakeId: row.stakeId,
          wager: row.wageredAmount,
          tickets: status === "ok" ? tickets : 0,
          status,
        });
      }
      
      const sorted = [...entries].filter(e => e.status === "ok").sort((a, b) => b.tickets - a.tickets);
      const top10 = sorted.slice(0, 10);
      
      const minWager = wagers.length ? Math.min(...wagers) : 0;
      const maxWager = wagers.length ? Math.max(...wagers) : 0;
      const avgWager = wagers.length ? wagers.reduce((a, b) => a + b, 0) / wagers.length : 0;
      const totalWager = wagers.reduce((a, b) => a + b, 0);
      
      return res.json({
        entries,
        summary: {
          eligibleUsers,
          totalTickets,
          top10,
          minWager,
          maxWager,
          avgWager: Math.round(avgWager),
          totalWager,
        },
        params,
      });
    } catch (err) {
      console.error("Export preview error:", err);
      return res.status(400).json({ message: "Invalid request" });
    }
  });

  app.post("/api/admin/export/generate", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const params = exportSchema.parse(req.body);
      const allData = getAllWagerData();
      const flaggedUsers = await db.select().from(userFlags);
      const blacklist = new Set(flaggedUsers.filter(f => f.isBlacklisted).map(f => f.stakeId));
      const disputed = new Set(flaggedUsers.filter(f => f.isDisputed).map(f => f.stakeId));
      
      const [allowlistToggle] = await db.select().from(featureToggles).where(eq(featureToggles.key, "ALLOWLIST_MODE_ENABLED"));
      const allowlistMode = allowlistToggle?.value === "true";
      const allowlist = new Set(flaggedUsers.filter(f => f.isAllowlisted).map(f => f.stakeId));
      
      const entries: { stake_id: string; tickets: number; campaign: string; week_label: string; generated_at: string }[] = [];
      let totalTickets = 0;
      
      for (const row of allData) {
        const normalizedId = row.stakeId.toLowerCase();
        if (blacklist.has(normalizedId)) continue;
        if (disputed.has(normalizedId)) continue;
        if (allowlistMode && !allowlist.has(normalizedId)) continue;
        if (row.wageredAmount <= 0) continue;
        
        const tickets = Math.floor(row.wageredAmount / params.ticketUnit);
        if (tickets <= 0) continue;
        
        totalTickets += tickets;
        entries.push({
          stake_id: row.stakeId,
          tickets,
          campaign: params.campaign,
          week_label: params.weekLabel,
          generated_at: new Date().toISOString(),
        });
      }
      
      // Compute data hash for integrity
      const dataHash = computeDataHash(allData);
      
      // Log export
      await db.insert(exportLogs).values({
        campaign: params.campaign,
        weekLabel: params.weekLabel,
        ticketUnit: params.ticketUnit,
        rowCount: entries.length,
        totalTickets,
        dataHash,
        exportedBy: "admin",
      });
      
      return res.json({
        entries,
        totalTickets,
        rowCount: entries.length,
        dataHash,
      });
    } catch (err) {
      console.error("Export generate error:", err);
      return res.status(400).json({ message: "Invalid request" });
    }
  });

  app.get("/api/admin/export/logs", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const logs = await db.select().from(exportLogs).orderBy(desc(exportLogs.createdAt)).limit(20);
    return res.json({ logs });
  });

  // =================== BACKUP EXPORT ===================
  app.get("/api/admin/backup-export", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const allData = getAllWagerData();
    const dataHash = computeDataHash(allData);
    
    return res.json({
      timestamp: new Date().toISOString(),
      dataHash,
      rowCount: allData.length,
      data: allData,
    });
  });

  // =================== DATA RESET ===================
  app.post("/api/admin/reset-data", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { confirm } = req.body;
      if (confirm !== "RESET_ALL_DATA") {
        return res.status(400).json({ 
          message: "Confirmation required. Send { confirm: 'RESET_ALL_DATA' } to proceed." 
        });
      }
      
      await db.delete(spinLogs);
      await db.delete(walletTransactions);
      await db.delete(userSpinBalances);
      await db.delete(userWallets);
      await db.delete(withdrawalRequests);
      await db.delete(userState);
      await db.delete(payouts);
      await db.delete(rateLimitLogs);
      await db.delete(guaranteedWins);
      
      return res.json({ 
        message: "All user data has been reset successfully.",
        tables_cleared: [
          "spin_logs", "wallet_transactions", "user_spin_balances", 
          "user_wallets", "withdrawal_requests", "user_state",
          "payouts", "rate_limit_logs", "guaranteed_wins"
        ]
      });
    } catch (err) {
      console.error("Data reset error:", err);
      return res.status(500).json({ message: "Failed to reset data" });
    }
  });

  // =================== USER VERIFICATION ===================
  
  // Rate limit tracking for verification submissions
  const verificationRateLimits = new Map<string, { count: number; resetTime: number }>();
  const VERIFICATION_RATE_LIMIT = 3; // 3 submissions per hour
  const VERIFICATION_RATE_WINDOW = 60 * 60 * 1000; // 1 hour
  
  function checkVerificationRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const limit = verificationRateLimits.get(userId);
    
    if (!limit || now > limit.resetTime) {
      verificationRateLimits.set(userId, { count: 1, resetTime: now + VERIFICATION_RATE_WINDOW });
      return { allowed: true };
    }
    
    if (limit.count >= VERIFICATION_RATE_LIMIT) {
      return { allowed: false, retryAfter: Math.ceil((limit.resetTime - now) / 1000) };
    }
    
    limit.count++;
    return { allowed: true };
  }
  
  // Submit verification request with screenshot (authenticated users only)
  // This is handled separately with multer middleware - see below
  
  // Get current user's verification status
  app.get("/api/verification/status", async (req: Request, res: Response) => {
    const userId = getCurrentUser(req);
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const [userData] = await db.select().from(users).where(eq(users.id, userId));
      
      if (!userData) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Get any pending requests
      const pendingRequests = await db.select().from(verificationRequests)
        .where(and(
          eq(verificationRequests.userId, userId),
          eq(verificationRequests.status, "pending")
        ));
      
      return res.json({
        stake_username: userData.stakeUsername,
        stake_platform: userData.stakePlatform,
        verification_status: userData.verificationStatus || "unverified",
        verified_at: userData.verifiedAt?.toISOString(),
        security_disclaimer_accepted: userData.securityDisclaimerAccepted,
        has_pending_request: pendingRequests.length > 0,
      });
    } catch (err) {
      console.error("Verification status error:", err);
      return res.status(500).json({ message: "Failed to get verification status" });
    }
  });
  
  // Accept security disclaimer
  app.post("/api/verification/accept-disclaimer", async (req: Request, res: Response) => {
    const userId = getCurrentUser(req);
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      await db.update(users).set({
        securityDisclaimerAccepted: true,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
      
      return res.json({ success: true });
    } catch (err) {
      console.error("Accept disclaimer error:", err);
      return res.status(500).json({ message: "Failed to accept disclaimer" });
    }
  });
  
  // Admin: Get all verification requests
  app.get("/api/admin/verifications", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const requests = await db.select({
        id: verificationRequests.id,
        userId: verificationRequests.userId,
        stakeUsername: verificationRequests.stakeUsername,
        stakePlatform: verificationRequests.stakePlatform,
        screenshotUrl: verificationRequests.screenshotUrl,
        screenshotFilename: verificationRequests.screenshotFilename,
        status: verificationRequests.status,
        adminNotes: verificationRequests.adminNotes,
        createdAt: verificationRequests.createdAt,
        processedAt: verificationRequests.processedAt,
        userEmail: users.email,
        username: users.username,
      })
        .from(verificationRequests)
        .leftJoin(users, eq(verificationRequests.userId, users.id))
        .orderBy(desc(verificationRequests.createdAt))
        .limit(100);
      
      return res.json({ verifications: requests });
    } catch (err) {
      console.error("Admin verifications error:", err);
      return res.status(500).json({ message: "Failed to fetch verifications" });
    }
  });
  
  // Admin: Process verification request
  app.post("/api/admin/verifications/process", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { id, status, admin_notes } = req.body;
      
      if (!id || !["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Invalid request. Provide id and status (approved/rejected)" });
      }
      
      // Use transaction for atomic updates
      const result = await db.transaction(async (tx) => {
        const [request] = await tx.select().from(verificationRequests).where(eq(verificationRequests.id, id));
        if (!request) {
          throw new Error("NOT_FOUND");
        }
        
        if (request.status !== "pending") {
          throw new Error("ALREADY_PROCESSED");
        }
        
        // Update verification request
        await tx.update(verificationRequests).set({
          status,
          adminNotes: admin_notes || null,
          processedAt: new Date(),
        }).where(eq(verificationRequests.id, id));
        
        // Update user status
        if (status === "approved") {
          await tx.update(users).set({
            verificationStatus: "verified",
            verifiedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(users.id, request.userId));
        } else {
          await tx.update(users).set({
            verificationStatus: "rejected",
            updatedAt: new Date(),
          }).where(eq(users.id, request.userId));
        }
        
        return request;
      });
      
      // Audit log for admin action
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: result.stakeUsername,
        details: `Admin ${status} verification for user ${result.userId}. Notes: ${admin_notes || "none"}`,
      });
      
      return res.json({ success: true, id, status });
    } catch (err: any) {
      if (err.message === "NOT_FOUND") {
        return res.status(404).json({ message: "Verification request not found" });
      }
      if (err.message === "ALREADY_PROCESSED") {
        return res.status(400).json({ message: "Verification request already processed" });
      }
      console.error("Process verification error:", err);
      return res.status(500).json({ message: "Failed to process verification" });
    }
  });

  // =================== ADMIN PASSWORD RESET ===================
  // Admin can reset a user's password to a new value
  app.post("/api/admin/reset-password", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { userId, newPassword } = req.body;
      
      if (!userId || !newPassword) {
        return res.status(400).json({ message: "userId and newPassword are required" });
      }
      
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      
      // Find the user
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Hash the new password
      const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      
      // Update the user's password
      await db.update(users).set({
        passwordHash,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
      
      // Log the password reset
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: user.stakeUsername || user.username,
        details: `Admin reset password for user ${user.username} (ID: ${userId})`,
      });
      
      console.log(`[Admin] Password reset for user ${user.username} (${userId})`);
      return res.json({ success: true, username: user.username });
    } catch (err) {
      console.error("Admin password reset error:", err);
      return res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Admin: Update wager data for a user
  app.post("/api/admin/update-wager", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { stakeUsername, lifetimeWagered, yearToDateWagered } = req.body;
      
      if (!stakeUsername) {
        return res.status(400).json({ message: "stakeUsername is required" });
      }
      
      if (!lifetimeWagered && !yearToDateWagered) {
        return res.status(400).json({ message: "At least one wagered amount is required" });
      }
      
      const lifetimeAmount = lifetimeWagered ? parseInt(lifetimeWagered, 10) : null;
      const ytdAmount = yearToDateWagered ? parseInt(yearToDateWagered, 10) : null;
      
      // Upsert wager override
      await db.insert(wagerOverrides).values({
        stakeId: stakeUsername.toLowerCase(),
        lifetimeWagered: lifetimeAmount,
        yearToDateWagered: ytdAmount,
        note: `Admin set wager data`,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: wagerOverrides.stakeId,
        set: {
          lifetimeWagered: lifetimeAmount,
          yearToDateWagered: ytdAmount,
          note: `Admin updated wager data`,
          updatedAt: new Date(),
        },
      });
      
      const tickets = ytdAmount ? Math.floor(ytdAmount / 1000) : 0;
      
      // Log the action
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: stakeUsername,
        details: `Admin set wager data: lifetime=${lifetimeAmount || 'N/A'}, ytd=${ytdAmount || 'N/A'}`,
      });
      
      console.log(`[Admin] Set wager data for ${stakeUsername}: lifetime=${lifetimeAmount}, ytd=${ytdAmount}, tickets=${tickets}`);
      return res.json({ success: true, stakeUsername, tickets });
    } catch (err) {
      console.error("Admin update wager error:", err);
      return res.status(500).json({ message: "Failed to update wager data" });
    }
  });

  // Admin: Update user verification status
  app.post("/api/admin/update-verification", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { userId, status } = req.body;
      
      if (!userId || !status) {
        return res.status(400).json({ message: "userId and status are required" });
      }
      
      if (!["unverified", "pending", "verified", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Invalid verification status" });
      }
      
      // Find the user
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Update verification status
      await db.update(users).set({
        verificationStatus: status,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
      
      // Log the action
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: user.stakeUsername || user.username,
        details: `Admin changed verification status for ${user.username} from ${user.verificationStatus} to ${status}`,
      });
      
      console.log(`[Admin] Changed verification for ${user.username}: ${user.verificationStatus} -> ${status}`);
      return res.json({ success: true, username: user.username, status });
    } catch (err) {
      console.error("Admin update verification error:", err);
      return res.status(500).json({ message: "Failed to update verification status" });
    }
  });

  // Admin: Create user manually
  app.post("/api/admin/create-user", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { username, password, email, stakeUsername, stakePlatform, verificationStatus, lifetimeWagered, yearToDateWagered } = req.body;
      
      // Validation
      if (!username || !password || !stakeUsername) {
        return res.status(400).json({ message: "Username, password, and stake username are required" });
      }
      
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      
      if (!["us", "com"].includes(stakePlatform)) {
        return res.status(400).json({ message: "Stake platform must be 'us' or 'com'" });
      }
      
      if (!["unverified", "pending", "verified", "rejected"].includes(verificationStatus)) {
        return res.status(400).json({ message: "Invalid verification status" });
      }
      
      // Check if username already exists
      const [existingUser] = await db.select().from(users).where(eq(users.username, username.toLowerCase()));
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
      
      // Check if stake username already registered
      const [existingStake] = await db.select().from(users).where(eq(users.stakeUsername, stakeUsername.toLowerCase()));
      if (existingStake) {
        return res.status(400).json({ message: "Stake username already registered" });
      }
      
      // Hash the password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      
      // Encrypt email if provided
      const encryptedEmail = email ? encrypt(email) : null;
      
      // Create the user
      const [newUser] = await db.insert(users).values({
        username: username.toLowerCase(),
        passwordHash,
        email: encryptedEmail,
        stakeUsername: stakeUsername.toLowerCase(),
        stakePlatform,
        verificationStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();
      
      // Create wager override if wagered amounts provided
      const lifetimeAmount = lifetimeWagered ? parseInt(lifetimeWagered, 10) : null;
      const ytdAmount = yearToDateWagered ? parseInt(yearToDateWagered, 10) : null;
      
      if (lifetimeAmount !== null || ytdAmount !== null) {
        await db.insert(wagerOverrides).values({
          stakeId: stakeUsername.toLowerCase(),
          lifetimeWagered: lifetimeAmount,
          yearToDateWagered: ytdAmount,
          note: `Created by admin for manually added user ${username}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: wagerOverrides.stakeId,
          set: {
            lifetimeWagered: lifetimeAmount,
            yearToDateWagered: ytdAmount,
            note: `Updated by admin for manually added user ${username}`,
            updatedAt: new Date(),
          },
        });
      }
      
      // Log the action
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: stakeUsername,
        details: `Admin created user ${username} with stake username ${stakeUsername}`,
      });
      
      console.log(`[Admin] Created user ${username} (stake: ${stakeUsername}, platform: ${stakePlatform}, status: ${verificationStatus}, lifetime: ${lifetimeAmount || 'N/A'}, ytd: ${ytdAmount || 'N/A'})`);
      return res.json({ success: true, username: newUser.username, id: newUser.id });
    } catch (err) {
      console.error("Admin create user error:", err);
      return res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Admin: Delete user (soft delete)
  app.delete("/api/admin/users/:userId", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { userId } = req.params;
      
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }
      
      // Find the user
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check if already deleted
      if (user.deletedAt) {
        return res.status(400).json({ message: "User already deleted" });
      }
      
      const stakeId = user.stakeUsername?.toLowerCase();
      
      // Soft delete - set deletedAt timestamp
      await db.update(users).set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
      
      // Revoke all user sessions
      await db.delete(sessions).where(
        sql`sess->>'userId' = ${userId}`
      );
      
      // Clean up wallet balance (set to 0)
      if (stakeId) {
        await db.update(userWallets).set({
          balance: 0,
          updatedAt: new Date(),
        }).where(eq(userWallets.stakeId, stakeId));
        
        // Clear spin balances
        await db.delete(userSpinBalances).where(eq(userSpinBalances.stakeId, stakeId));
        
        // Cancel any pending withdrawals
        await db.update(withdrawalRequests).set({
          status: "rejected",
          adminNotes: "User account deleted",
          processedAt: new Date(),
        }).where(
          and(
            eq(withdrawalRequests.stakeId, stakeId),
            eq(withdrawalRequests.status, "pending")
          )
        );
      }
      
      // Log the action
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: user.stakeUsername || user.username,
        details: `Admin deleted user account: ${user.username} (stake: ${user.stakeUsername || 'N/A'})`,
      });
      
      console.log(`[Admin] Deleted user ${user.username} (stake: ${user.stakeUsername || 'N/A'})`);
      return res.json({ success: true, username: user.username });
    } catch (err) {
      console.error("Admin delete user error:", err);
      console.error("Delete user params:", { userId: req.params.userId });
      return res.status(500).json({ message: "Failed to delete user", error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return httpServer;
}
