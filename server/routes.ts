import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { 
  lookupRequestSchema, spinRequestSchema, convertSpinsRequestSchema, 
  purchaseSpinsRequestSchema, withdrawRequestSchema, processWithdrawalSchema,
  spinLogs, userWallets, userSpinBalances, 
  withdrawalRequests, walletTransactions,
  userFlags, adminSessions, adminCredentials, exportLogs, featureToggles, payouts, rateLimitLogs, userState, guaranteedWins,
  wagerOverrides, passwordResetTokens, sessions,
  CASE_PRIZES, selectCasePrize, validatePrizeProbabilities, type CasePrize, type SpinBalances,
  users, verificationRequests, registerSchema, loginSchema, referrals
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
import { isRateLimited, isStakeIdRateLimited, isAdminLoginRateLimited, getAdminLoginLockoutMs, resetAdminLoginAttempts, isAuthRateLimited, getAuthLockoutMs, resetAuthAttempts } from "./lib/rateLimit";
import { config } from "./lib/config";
import { encrypt, decrypt } from "./lib/encryption";
import { generateToken } from "./lib/jwt";
import { ZodError, z } from "zod";
import { db } from "./db";
import { eq, desc, sql, and, gte, lt, isNull } from "drizzle-orm";
import crypto from "crypto";
import { 
  logSecurityEvent, 
  SESSION_CONFIG, 
  hashForLogging, 
  getClientIpForSecurity,
  generateCSRFToken,
  getRecentSecurityEvents
} from "./lib/security";
import { logAdminActivity, getAdminActivityLogs, getAdminActivityLogCount, type AdminAction, type TargetType } from "./lib/adminActivityLog";
import { createBackup, getBackupStatus, listBackupFiles } from "./lib/backup";
import { sendPasswordResetEmail, sendVerificationApprovedEmail, sendPasswordChangedEmail } from "./lib/email";


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
  
  // =================== DEBUG ENDPOINTS ===================
  
  // Debug endpoint to check if a username exists in sheets (development only)
  app.get("/api/debug/check-username/:username", async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ message: "Not found" });
    }
    
    const { username } = req.params;
    const { usernameExistsInSpreadsheet, getWagerRow, getWeightedWagerWithDomain } = await import("./lib/sheets");
    
    const normalizedUsername = username.toLowerCase().trim();
    const existsInSheet = usernameExistsInSpreadsheet(normalizedUsername);
    const ngrData = await getWagerRow(normalizedUsername);
    const weightedData = getWeightedWagerWithDomain(normalizedUsername);
    
    res.json({
      username: normalizedUsername,
      existsInAnySheet: existsInSheet,
      ngrSheet: ngrData ? { found: true, wageredAmount: ngrData.wageredAmount } : { found: false },
      weighted: weightedData.wager > 0 ? { found: true, wagered: weightedData.wager, domain: weightedData.domain } : { found: false },
    });
  });
  
  // =================== CUSTOM AUTHENTICATION ===================
  
  // Register new user - username must exist in the appropriate spreadsheet
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const clientIp = getClientIpForSecurity(req);
    const ipHash = hashForLogging(clientIp);
    
    // Rate limit registration attempts
    if (isAuthRateLimited(ipHash)) {
      const lockoutMs = getAuthLockoutMs(ipHash);
      const lockoutMinutes = Math.ceil(lockoutMs / 60000);
      logSecurityEvent({
        type: "rate_limit_exceeded",
        ipHash,
        details: `Registration rate limit exceeded. Locked for ${lockoutMinutes} minutes`,
      });
      return res.status(429).json({ 
        message: `Too many registration attempts. Try again in ${lockoutMinutes} minutes.` 
      });
    }
    
    try {
      console.log("[Register] Request received:", {
        hasBody: !!req.body,
        origin: req.headers.origin,
      });
      
      const parsed = registerSchema.parse(req.body);
      const { username, password, email, stakePlatform, referralCode: inputReferrer } = parsed;
      
      console.log("[Register] Attempting registration for:", username, "platform:", stakePlatform);
      
      // Validate username exists in the appropriate spreadsheet
      const { usernameExistsInSpreadsheet } = await import("./lib/sheets");
      const existsInSheet = usernameExistsInSpreadsheet(username, stakePlatform);
      console.log("[Register] Username exists in sheet:", existsInSheet);
      
      if (!existsInSheet) {
        return res.status(400).json({ 
          message: `Username "${username}" not found in ${stakePlatform === "us" ? "Stake.us" : "Stake.com"} records. Please use your Stake username.` 
        });
      }
      
      // Check if username already exists in our database (allow re-registration if user was deleted)
      const [existing] = await db.select().from(users).where(eq(users.username, username.toLowerCase()));
      if (existing && !existing.deletedAt) {
        return res.status(400).json({ message: "Username already registered" });
      }
      
      // If user was previously deleted, remove the old record to allow fresh registration
      if (existing && existing.deletedAt) {
        console.log("[Register] Removing previously deleted user to allow re-registration:", username);
        await db.delete(users).where(eq(users.id, existing.id));
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
      
      // Create referral record - use default referrer (ergysonuzi) if no referral provided
      const referrerToLookup = inputReferrer || "ergysonuzi";
      const [referrer] = await db.select().from(users)
        .where(sql`LOWER(${users.username}) = LOWER(${referrerToLookup})`);
      if (referrer && !referrer.deletedAt) {
        await db.insert(referrals).values({
          referrerUserId: referrer.id,
          referredUserId: newUser.id,
          referralCode: referrer.username,
          status: "pending",
        });
        console.log(`[Register] Referral record created for user ${newUser.username}, referred by ${referrer.username}`);
      }
      
      // Set session (best effort - may fail in iframe contexts)
      (req.session as any).userId = newUser.id;
      
      // Try to save session but don't block registration if it fails
      // JWT token auth will work regardless of session state
      try {
        await new Promise<void>((resolve) => {
          req.session.save((err) => {
            if (err) {
              console.warn("[Register] Session save failed (non-blocking):", err.message);
            } else {
              console.log("[Register] Session saved successfully for user:", newUser.id);
            }
            resolve();
          });
        });
      } catch (sessionErr) {
        console.warn("[Register] Session error (continuing with token auth):", sessionErr);
      }
      
      // Reset rate limit on successful registration
      resetAuthAttempts(ipHash);
      
      logSecurityEvent({
        type: "auth_success",
        ipHash,
        stakeId: username,
        details: "User registration successful",
      });
      
      const token = generateToken({ userId: newUser.id, username: newUser.username });
      
      return res.json({
        success: true,
        token,
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
      // Log detailed error info for debugging
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : typeof err;
      console.error("Registration error:", {
        message: errorMessage,
        stack: err instanceof Error ? err.stack : undefined,
        name: errorName,
      });
      // Include error details in response for debugging production issues
      return res.status(500).json({ 
        message: "Registration failed",
        error: errorMessage,
        errorType: errorName,
      });
    }
  });
  
  // Login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const clientIp = getClientIpForSecurity(req);
    const ipHash = hashForLogging(clientIp);
    
    // Rate limit login attempts
    if (isAuthRateLimited(ipHash)) {
      const lockoutMs = getAuthLockoutMs(ipHash);
      const lockoutMinutes = Math.ceil(lockoutMs / 60000);
      logSecurityEvent({
        type: "rate_limit_exceeded",
        ipHash,
        details: `Login rate limit exceeded. Locked for ${lockoutMinutes} minutes`,
      });
      return res.status(429).json({ 
        message: `Too many login attempts. Try again in ${lockoutMinutes} minutes.` 
      });
    }
    
    try {
      console.log("[Login] Request received:", {
        hasBody: !!req.body,
        origin: req.headers.origin,
        referer: req.headers.referer?.substring(0, 50),
      });
      
      const parsed = loginSchema.parse(req.body);
      const { username, password } = parsed;
      
      console.log("[Login] Attempting login for:", username);
      
      // Find user
      const [user] = await db.select().from(users).where(eq(users.username, username.toLowerCase()));
      console.log("[Login] User found:", !!user);
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
      
      // Set session (best effort - may fail in iframe contexts)
      (req.session as any).userId = user.id;
      
      // Try to save session but don't block login if it fails
      // JWT token auth will work regardless of session state
      try {
        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.warn("[Login] Session save failed (non-blocking):", err.message);
              // Don't reject - just log and continue with token auth
              resolve();
            } else {
              console.log("[Login] Session saved successfully:", {
                userId: user.id,
                sessionId: req.session.id?.substring(0, 8) + "...",
              });
              resolve();
            }
          });
        });
      } catch (sessionErr) {
        // Session save failed but we'll continue with token auth
        console.warn("[Login] Session error (continuing with token auth):", sessionErr);
      }
      
      // Reset rate limit counter on successful login
      resetAuthAttempts(ipHash);
      
      logSecurityEvent({
        type: "auth_success",
        ipHash,
        stakeId: username,
        details: "User login successful",
      });
      
      const token = generateToken({ userId: user.id, username: user.username });
      
      return res.json({
        success: true,
        token,
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
      // Log detailed error info for debugging
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : typeof err;
      console.error("Login error:", {
        message: errorMessage,
        stack: err instanceof Error ? err.stack : undefined,
        name: errorName,
      });
      // Include error details in response for debugging production issues
      return res.status(500).json({ 
        message: "Login failed",
        error: errorMessage,
        errorType: errorName,
      });
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

  // =================== FORGOT PASSWORD ===================
  // User requests a password reset email
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      // Find user by email - need to check all users since email is encrypted
      const allUsers = await db.select().from(users).where(isNull(users.deletedAt));
      
      let user = null;
      let userEmail = "";
      for (const u of allUsers) {
        const storedEmail = u.email ? decrypt(u.email) : "";
        if (storedEmail.toLowerCase() === email.toLowerCase().trim()) {
          user = u;
          userEmail = storedEmail;
          break;
        }
      }
      
      if (!user) {
        // Don't reveal whether user exists
        return res.json({ success: true, message: "If an account with that email exists, a reset link has been sent." });
      }
      
      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry
      
      // Delete any existing tokens for this user
      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
      
      // Store hashed token in database
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });
      
      // Send reset email - construct full URL (require BASE_URL for security)
      const baseUrl = process.env.BASE_URL;
      if (!baseUrl) {
        console.error("[Password Reset] BASE_URL environment variable not set");
        return res.status(500).json({ message: "Server configuration error. Please contact support." });
      }
      const resetLink = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
      const emailResult = await sendPasswordResetEmail(userEmail, user.username, resetLink);
      if (!emailResult.success) {
        console.error("[Password Reset] Failed to send email:", emailResult.error);
        return res.status(500).json({ message: "Failed to send reset email. Please try again later." });
      }
      
      console.log("[Password Reset] Reset email sent for user:", user.username);
      
      return res.json({ success: true, message: "If an account with that email exists, a reset link has been sent." });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      const errorName = err instanceof Error ? err.name : "UnknownError";
      console.error("Forgot password error:", err);
      return res.status(500).json({ 
        message: "An error occurred. Please try again later.",
        error: errorMessage,
        errorType: errorName,
      });
    }
  });

  // Reset password with token
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, newPassword } = req.body;
      
      console.log("[Password Reset] Received token:", token ? `${token.substring(0, 10)}... (length: ${token.length})` : "MISSING");
      
      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }
      
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      
      // Hash the provided token to compare with stored hash
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      console.log("[Password Reset] Computed hash prefix:", tokenHash.substring(0, 20));
      
      // Find valid token
      const [resetRecord] = await db.select().from(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          gte(passwordResetTokens.expiresAt, new Date())
        ));
      
      // Debug: check all tokens in DB
      const allTokens = await db.select().from(passwordResetTokens);
      console.log("[Password Reset] All tokens in DB:", allTokens.map(t => ({
        hashPrefix: t.tokenHash.substring(0, 20),
        expiresAt: t.expiresAt,
        isExpired: new Date() > new Date(t.expiresAt)
      })));
      
      if (!resetRecord) {
        console.log("[Password Reset] No matching token found");
        return res.status(400).json({ message: "Invalid or expired reset link" });
      }
      
      // Find the user
      const [user] = await db.select().from(users).where(eq(users.id, resetRecord.userId));
      if (!user) {
        return res.status(400).json({ message: "User not found" });
      }
      
      // Hash new password
      const SALT_ROUNDS = 12;
      const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      
      // Update password
      await db.update(users).set({
        passwordHash,
        updatedAt: new Date(),
      }).where(eq(users.id, user.id));
      
      // Delete the used token
      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, resetRecord.id));
      
      // Log the reset
      logSecurityEvent({
        type: "auth_success",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        stakeId: user.stakeUsername || user.username,
        details: "Password reset completed successfully",
      });
      
      console.log("[Password Reset] Password reset completed for user:", user.username);
      
      // Send password changed confirmation email
      if (user.email) {
        try {
          const decryptedEmail = decrypt(user.email);
          await sendPasswordChangedEmail(decryptedEmail, user.username);
        } catch (emailErr) {
          console.error("[Password Reset] Failed to send confirmation email:", emailErr);
        }
      }
      
      return res.json({ success: true, message: "Password has been reset successfully. You can now log in." });
    } catch (err) {
      console.error("Reset password error:", err);
      return res.status(500).json({ message: "An error occurred. Please try again later." });
    }
  });
  
  // Get current session - uses centralized auth middleware for both cookies and tokens
  app.get("/api/auth/session", async (req: Request, res: Response) => {
    const userId = req.userId;
    const authMethod = req.authMethod;
    
    if (!userId) {
      const sessionDebug = {
        hasSession: !!req.session,
        sessionId: req.session?.id?.substring(0, 8) + "...",
        hasCookie: !!req.cookies?.["connect.sid"],
        allCookies: Object.keys(req.cookies || {}),
        hasAuthHeader: !!req.headers.authorization,
        cookieHeader: !!req.headers.cookie,
      };
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
        if (authMethod === "session") {
          req.session.destroy(() => {});
        }
        return res.json({ user: null });
      }
      
      // If authenticated via token, issue a fresh token (sliding expiration)
      const newToken = authMethod === "token" ? generateToken({ userId: user.id, username: user.username }) : undefined;
      
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
        ...(newToken && { token: newToken }),
      });
    } catch (err) {
      console.error("Session check error:", err);
      return res.json({ user: null });
    }
  });
  
  // Helper middleware to get current user - uses centralized req.userId from auth middleware
  function getCurrentUser(req: Request): string | null {
    return req.userId || null;
  }
  
  // =================== VERIFICATION WITH IMAGE UPLOAD ===================
  
  // Submit verification request with screenshot
  app.post("/api/verification/submit", upload.single("screenshot"), async (req: Request, res: Response) => {
    // Debug: Log auth state for troubleshooting
    console.log("[Verification Submit] Auth debug:", {
      hasUserId: !!req.userId,
      authMethod: req.authMethod,
      hasCookie: !!req.cookies?.["connect.sid"],
      hasAuthHeader: !!req.headers.authorization,
    });
    
    const userId = getCurrentUser(req);
    if (!userId) {
      console.log("[Verification Submit] Auth failed - no userId");
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
      }).from(users).where(isNull(users.deletedAt)).orderBy(desc(users.createdAt));
      
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
  
  // Get bonus event status from feature toggles
  async function getBonusEventStatus(): Promise<{ active: boolean; multiplier: number; name: string }> {
    const toggles = await db.select().from(featureToggles)
      .where(sql`${featureToggles.key} IN ('BONUS_EVENT_ACTIVE', 'BONUS_EVENT_MULTIPLIER', 'BONUS_EVENT_NAME')`);
    
    const activeToggle = toggles.find(t => t.key === "BONUS_EVENT_ACTIVE");
    const multiplierToggle = toggles.find(t => t.key === "BONUS_EVENT_MULTIPLIER");
    const nameToggle = toggles.find(t => t.key === "BONUS_EVENT_NAME");
    
    return {
      active: activeToggle?.value === "true",
      multiplier: parseFloat(multiplierToggle?.value || "1.5") || 1.5,
      name: nameToggle?.value || "Bonus Event",
    };
  }
  
  // Public endpoint for bonus event status (no auth required)
  app.get("/api/bonus-event", async (_req: Request, res: Response) => {
    try {
      const status = await getBonusEventStatus();
      return res.json(status);
    } catch (err) {
      console.error("Bonus event status error:", err);
      return res.json({ active: false, multiplier: 1, name: "" });
    }
  });
  
  // Check and award referral bonus when referred user hits $1k weekly wager
  const REFERRAL_BONUS_AMOUNT = 200; // $2 in cents
  async function checkAndAwardReferralBonus(userId: string, weeklyWager: number): Promise<boolean> {
    const MIN_WEEKLY_WAGER_FOR_REFERRAL = 1000;
    
    // Only check if weekly wager meets threshold
    if (weeklyWager < MIN_WEEKLY_WAGER_FOR_REFERRAL) {
      return false;
    }
    
    // Find pending referral where this user is the referred user
    const [pendingReferral] = await db.select().from(referrals)
      .where(and(
        eq(referrals.referredUserId, userId),
        eq(referrals.status, "pending")
      ));
    
    if (!pendingReferral) {
      return false;
    }
    
    // Get the referrer's stake username for wallet credit
    const [referrer] = await db.select().from(users).where(eq(users.id, pendingReferral.referrerUserId));
    if (!referrer) {
      console.error(`[Referral] Referrer not found: ${pendingReferral.referrerUserId}`);
      return false;
    }
    
    // Referrer must have a stake username to receive wallet credit
    // Keep as pending so bonus can be awarded once referrer links their Stake account
    if (!referrer.stakeUsername) {
      console.log(`[Referral] Referrer ${referrer.username} has no stake username yet, keeping as pending for later processing`);
      return false;
    }
    
    // Use atomic status update to prevent race conditions
    // Update status FIRST, checking that it's still "pending" (atomic check-and-set)
    // Use .returning() to check if any rows were actually updated
    const updateResult = await db.update(referrals)
      .set({ 
        status: "processing",
      })
      .where(and(eq(referrals.id, pendingReferral.id), eq(referrals.status, "pending")))
      .returning({ id: referrals.id });
    
    // If no rows updated, another process already started processing
    if (!updateResult || updateResult.length === 0) {
      console.log(`[Referral] Referral ${pendingReferral.id} already being processed`);
      return false;
    }
    
    try {
      // Award bonus to referrer's wallet
      const referrerStakeId = referrer.stakeUsername.toLowerCase();
      await db.insert(userWallets).values({
        stakeId: referrerStakeId,
        balance: REFERRAL_BONUS_AMOUNT,
      }).onConflictDoUpdate({
        target: userWallets.stakeId,
        set: { 
          balance: sql`${userWallets.balance} + ${REFERRAL_BONUS_AMOUNT}`,
          updatedAt: new Date(),
        },
      });
      
      // Log the transaction
      await db.insert(walletTransactions).values({
        stakeId: referrerStakeId,
        type: "referral_bonus",
        amount: REFERRAL_BONUS_AMOUNT,
        description: `Referral bonus for referring a new user`,
      });
      
      // Mark as qualified with bonus awarded
      await db.update(referrals)
        .set({ 
          status: "qualified",
          bonusAwarded: REFERRAL_BONUS_AMOUNT,
          qualifiedAt: new Date(),
        })
        .where(eq(referrals.id, pendingReferral.id));
      
      console.log(`[Referral] Awarded $${REFERRAL_BONUS_AMOUNT / 100} to ${referrerStakeId} for referral`);
      return true;
    } catch (err) {
      // If wallet credit fails, revert status back to pending so it can be retried
      console.error(`[Referral] Failed to award bonus for referral ${pendingReferral.id}:`, err);
      await db.update(referrals)
        .set({ status: "pending" })
        .where(eq(referrals.id, pendingReferral.id));
      return false;
    }
  }

  app.post("/api/lookup", async (req: Request, res: Response) => {
    try {
      // Require authentication (uses centralized auth middleware)
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ message: "Please log in to view your tickets." } as ErrorResponse);
      }

      // Get logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, userId));
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
      
      let weeklyWager = 0;
      const MIN_WEEKLY_WAGER = 1000;
      
      if (hasDbOverride) {
        // User exists in database - use override values (or 0 if not set)
        lifetimeWagered = override.lifetimeWagered ?? 0;
        weightedWager = override.yearToDateWagered ?? 0;
        weeklyWager = MIN_WEEKLY_WAGER; // Admin-added users automatically meet requirement
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
        weeklyWager = wagerRow?.wageredWeekly ?? 0;
        periodLabel = wagerRow?.periodLabel || "2026";
      }
      
      const ticketsTotal = calculateTickets(weightedWager);
      const ticketsUsed = await countSpinsForStakeId(stakeId);
      const ticketsRemaining = Math.max(0, ticketsTotal - ticketsUsed);
      
      // Check and award referral bonus if user qualifies (runs in background)
      checkAndAwardReferralBonus(userId, weeklyWager).catch(err => {
        console.error("[Referral] Error checking referral bonus:", err);
      });
      
      const walletBalance = await getWalletBalance(stakeId);
      const spinBalances = await getSpinBalances(stakeId);
      const pendingWithdrawals = await getPendingWithdrawals(stakeId);
      
      // Check daily bonus availability
      const bonusStatus = await canUseDailyBonus(stakeId);
      const bonusWagerMet = weeklyWager >= MIN_WEEKLY_WAGER;

      const response: LookupResponse = {
        stake_id: stakeId,
        period_label: periodLabel,
        wagered_amount: weightedWager,
        lifetime_wagered: lifetimeWagered,
        weekly_wager: Math.floor(weeklyWager),
        tickets_total: ticketsTotal,
        tickets_used: ticketsUsed,
        tickets_remaining: ticketsRemaining,
        wallet_balance: walletBalance,
        spin_balances: spinBalances,
        pending_withdrawals: pendingWithdrawals,
        can_daily_bonus: bonusStatus.canUse && bonusWagerMet,
        next_bonus_at: bonusStatus.nextBonusAt?.toISOString(),
        bonus_wager_met: bonusWagerMet,
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

  // Get user's referral stats
  app.get("/api/referrals", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ message: "Please log in to view referrals." });
      }
      
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(401).json({ message: "User not found." });
      }
      
      // Get who referred this user
      let referredBy: { username: string; joinedAt: string | null } | null = null;
      const [myReferral] = await db.select({
        referrerUserId: referrals.referrerUserId,
        createdAt: referrals.createdAt,
      }).from(referrals).where(eq(referrals.referredUserId, userId));
      
      if (myReferral) {
        const [referrer] = await db.select({ username: users.username }).from(users).where(eq(users.id, myReferral.referrerUserId));
        if (referrer) {
          referredBy = {
            username: referrer.username,
            joinedAt: myReferral.createdAt?.toISOString() || null,
          };
        }
      }
      
      // Get referrals where this user is the referrer
      const myReferrals = await db.select({
        id: referrals.id,
        referredUserId: referrals.referredUserId,
        status: referrals.status,
        bonusAwarded: referrals.bonusAwarded,
        createdAt: referrals.createdAt,
        qualifiedAt: referrals.qualifiedAt,
      }).from(referrals).where(eq(referrals.referrerUserId, userId));
      
      // Get referred user usernames (NOT masked - user should see who they referred)
      const referralDetails = await Promise.all(myReferrals.map(async (ref) => {
        const [referredUser] = await db.select({ username: users.username }).from(users).where(eq(users.id, ref.referredUserId));
        return {
          id: ref.id,
          username: referredUser?.username || "Unknown",
          status: ref.status,
          bonusAwarded: ref.bonusAwarded || 0,
          createdAt: ref.createdAt?.toISOString() || null,
          qualifiedAt: ref.qualifiedAt?.toISOString() || null,
        };
      }));
      
      // Calculate totals
      const totalReferrals = myReferrals.length;
      const qualifiedReferrals = myReferrals.filter(r => r.status === "qualified").length;
      const totalBonusEarned = myReferrals.reduce((sum, r) => sum + (r.bonusAwarded || 0), 0);
      
      return res.json({
        referralCode: user.username, // Use username as referral code
        referredBy,
        totalReferrals,
        qualifiedReferrals,
        pendingReferrals: totalReferrals - qualifiedReferrals,
        totalBonusEarned,
        referrals: referralDetails,
      });
    } catch (err) {
      console.error("Referral stats error:", err);
      return res.status(500).json({ message: "Failed to fetch referral stats." });
    }
  });

  app.post("/api/spin", async (req: Request, res: Response) => {
    try {
      // Require login before spinning (uses centralized auth middleware)
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ message: "Please log in to spin." } as ErrorResponse);
      }

      // Get the logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, userId));
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
        weightedWager = getWeightedWager(stakeId, domain);
        
        // User must exist in either NGR sheet OR weighted sheets
        if (!wagerRow && weightedWager === 0) {
          const existsInWeighted = usernameExistsInSpreadsheet(stakeId, domain);
          if (!existsInWeighted) {
            return res.status(404).json({ message: "Stake ID not found in our records." } as ErrorResponse);
          }
        }
        
        lifetimeWagered = wagerRow?.wageredAmount ?? 0;
      }
      
      // Calculate tickets from weighted wager
      const ticketsTotal = calculateTickets(weightedWager);
      const ticketsUsedBefore = await countSpinsForStakeId(stakeId);
      const ticketsRemaining = ticketsTotal - ticketsUsedBefore;

      // Check granted spin balances (bronze tier = free spins)
      const spinBalances = await getSpinBalances(stakeId);
      const grantedBronzeSpins = spinBalances.bronze;

      // Check if user has tickets OR granted spins
      const hasTickets = ticketsRemaining > 0;
      const hasGrantedSpins = grantedBronzeSpins > 0;
      
      if (!hasTickets && !hasGrantedSpins) {
        return res.status(403).json({ message: "No tickets remaining." } as ErrorResponse);
      }
      
      // Determine spin source: prefer free tickets, then granted spins
      const usingGrantedSpin = !hasTickets && hasGrantedSpins;

      // Check for active bonus event
      const bonusEvent = await getBonusEventStatus();
      
      // Apply bonus multiplier to win probabilities if event is active
      let prizesToUse = CASE_PRIZES;
      if (bonusEvent.active && bonusEvent.multiplier > 1) {
        // Normalize win probabilities while respecting multiplier boost
        // We increase the relative weight of winning prizes by the multiplier
        // then renormalize everything to sum to 100%
        const multiplier = Math.min(bonusEvent.multiplier, 5); // Cap at 5x for safety
        
        // Calculate current totals
        const currentLossProb = CASE_PRIZES.filter(p => p.value === 0).reduce((sum, p) => sum + p.probability, 0);
        const currentWinProb = 100 - currentLossProb;
        
        // Apply multiplier to win probability (capped so total win can't exceed 90%)
        const boostedWinProb = Math.min(currentWinProb * multiplier, 90);
        const newLossProb = 100 - boostedWinProb;
        
        // Scale each prize proportionally to maintain distribution
        const winScaleFactor = boostedWinProb / currentWinProb;
        const lossScaleFactor = newLossProb / currentLossProb;
        
        prizesToUse = CASE_PRIZES.map(prize => ({
          ...prize,
          probability: prize.value === 0 
            ? prize.probability * lossScaleFactor 
            : prize.probability * winScaleFactor
        }));
      }
      
      // Use weighted random selection for case prize
      const prize = selectCasePrize(prizesToUse);
      const isWin = prize.value > 0;
      
      // Calculate spin tracking based on source
      let spinNumber: number;
      let ticketsUsedAfter: number;
      let ticketsRemainingAfter: number;
      
      if (usingGrantedSpin) {
        // Deduct from granted spin balance
        const [bronzeBalance] = await db.select().from(userSpinBalances)
          .where(and(
            eq(userSpinBalances.stakeId, stakeId),
            eq(userSpinBalances.tier, "bronze")
          ));
        
        if (bronzeBalance && bronzeBalance.balance > 0) {
          await db.update(userSpinBalances)
            .set({ balance: bronzeBalance.balance - 1 })
            .where(eq(userSpinBalances.id, bronzeBalance.id));
        }
        
        // For granted spins, don't affect the free ticket counts
        spinNumber = ticketsUsedBefore; // Don't increment
        ticketsUsedAfter = ticketsUsedBefore;
        ticketsRemainingAfter = ticketsRemaining;
      } else {
        // Normal free ticket spin
        spinNumber = ticketsUsedBefore + 1;
        ticketsUsedAfter = spinNumber;
        ticketsRemainingAfter = ticketsTotal - ticketsUsedAfter;
      }

      // Log spin to database (use lowercase stakeId for consistent counting)
      // Mark granted spins with isBonus: true so they don't count against free tickets
      await db.insert(spinLogs).values({
        stakeId: stakeId,
        wageredAmount: lifetimeWagered,
        spinNumber,
        result: isWin ? "WIN" : "LOSE",
        prizeLabel: prize.label,
        prizeValue: prize.value,
        prizeColor: prize.color,
        isBonus: usingGrantedSpin, // true for granted spins, false for free tickets
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
      // SECURITY: Require authentication (uses centralized auth middleware)
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ message: "Please log in to claim bonus." } as ErrorResponse);
      }

      // Get the logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, userId));
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

      // Minimum weekly wager requirement for daily bonus
      const MIN_WEEKLY_WAGER = 1000;
      
      // Check for database override first (for manually added users)
      const override = await getWagerOverride(stakeId);
      let wageredAmount = 0;
      let weeklyWager = 0;
      
      if (override && (override.lifetimeWagered !== null || override.yearToDateWagered !== null)) {
        // Use override values (for testing/manual users)
        wageredAmount = override.yearToDateWagered ?? override.lifetimeWagered ?? 0;
        // For overrides, assume they meet weekly requirement (admin-added users)
        weeklyWager = MIN_WEEKLY_WAGER;
      } else {
        // Fall back to Google Sheets data
        const wagerRow = await getWagerRow(stakeId);
        if (!wagerRow) {
          return res.status(404).json({ message: "Stake ID not found in wagering data" } as ErrorResponse);
        }
        wageredAmount = wagerRow.wageredAmount;
        weeklyWager = wagerRow.wageredWeekly || 0;
      }
      
      // Check weekly wager requirement
      if (weeklyWager < MIN_WEEKLY_WAGER) {
        return res.status(403).json({ 
          message: `Daily bonus requires $${MIN_WEEKLY_WAGER.toLocaleString()}+ wagered this week. You have $${Math.floor(weeklyWager).toLocaleString()} wagered.`,
          weekly_wager: weeklyWager,
          required_wager: MIN_WEEKLY_WAGER,
        } as ErrorResponse);
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

  // Track demo spin counts per IP to give wins every 2-3 spins
  const demoSpinCounts = new Map<string, number>();
  
  // Demo spin - no login required, just for trying the experience
  app.post("/api/spin/demo", async (req: Request, res: Response) => {
    try {
      const ipHash = hashIp(req.ip || "unknown");
      
      // Get current spin count for this IP
      const currentCount = demoSpinCounts.get(ipHash) || 0;
      const newCount = currentCount + 1;
      demoSpinCounts.set(ipHash, newCount);
      
      // Win on 2nd spin, then every 2-3 spins after
      // Pattern: LOSE, WIN, LOSE, WIN, LOSE, LOSE, WIN, etc.
      let isWin = false;
      if (newCount === 2) {
        isWin = true; // Always win on 2nd spin to hook them
      } else if (newCount > 2) {
        // After that, win roughly every 2-3 spins (40% chance)
        isWin = Math.random() < 0.40;
      }
      
      // Generate prize based on result
      const prize = isWin 
        ? { label: "$5", value: 5, color: "green" as const }
        : { label: "$0", value: 0, color: "grey" as const };

      console.log(`[Demo Spin] IP: ${ipHash.slice(0, 8)}... Spin #${newCount} Result: ${isWin ? "WIN" : "LOSE"}`);

      return res.json({
        stake_id: "demo_user",
        result: isWin ? "WIN" : "LOSE",
        prize_label: prize.label,
        prize_value: prize.value,
        prize_color: prize.color,
        wallet_balance: 0,
        is_demo: true,
      });
    } catch (err) {
      console.error("Demo spin error:", err);
      return res.status(500).json({ message: "Something went wrong" } as ErrorResponse);
    }
  });

  // Check bonus spin availability
  app.post("/api/spin/bonus/check", async (req: Request, res: Response) => {
    try {
      // SECURITY: Require authentication (uses centralized auth middleware)
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ message: "Please log in to check bonus status." } as ErrorResponse);
      }

      // Get the logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!loggedInUser) {
        return res.status(401).json({ message: "Session invalid. Please log in again." } as ErrorResponse);
      }

      // SECURITY: Use the authenticated user's stake ID
      const stakeId = loggedInUser.stakeUsername?.toLowerCase();
      if (!stakeId) {
        return res.status(400).json({ message: "No Stake username linked to your account." } as ErrorResponse);
      }

      // Check weekly wager requirement
      const MIN_WEEKLY_WAGER = 1000;
      let weeklyWager = 0;
      let meetsWagerRequirement = false;
      
      const override = await getWagerOverride(stakeId);
      if (override && (override.lifetimeWagered !== null || override.yearToDateWagered !== null)) {
        // Admin-added users automatically meet requirement
        weeklyWager = MIN_WEEKLY_WAGER;
        meetsWagerRequirement = true;
      } else {
        const wagerRow = await getWagerRow(stakeId);
        weeklyWager = wagerRow?.wageredWeekly || 0;
        meetsWagerRequirement = weeklyWager >= MIN_WEEKLY_WAGER;
      }

      const [state] = await db.select().from(userState).where(eq(userState.stakeId, stakeId));
      
      const cooldownMs = 24 * 60 * 60 * 1000;
      const now = new Date();
      
      // Check cooldown
      let cooldownAvailable = true;
      let remainingMs = 0;
      let nextBonusAt: string | null = null;
      
      if (state?.lastBonusSpinAt) {
        const timeSince = now.getTime() - state.lastBonusSpinAt.getTime();
        cooldownAvailable = timeSince >= cooldownMs;
        remainingMs = cooldownAvailable ? 0 : cooldownMs - timeSince;
        nextBonusAt = cooldownAvailable ? null : new Date(state.lastBonusSpinAt.getTime() + cooldownMs).toISOString();
      }

      return res.json({
        available: cooldownAvailable && meetsWagerRequirement,
        remaining_ms: remainingMs,
        next_bonus_at: nextBonusAt,
        weekly_wager: Math.floor(weeklyWager),
        required_wager: MIN_WEEKLY_WAGER,
        meets_wager_requirement: meetsWagerRequirement,
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
      // SECURITY: Require authentication (uses centralized auth middleware)
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" } as ErrorResponse);
      }

      // Get logged-in user
      const [loggedInUser] = await db.select().from(users).where(eq(users.id, userId));
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

  // Admin: Get all wallet balances (winners)
  app.get("/api/admin/wallets", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const wallets = await db.select().from(userWallets)
        .where(sql`${userWallets.balance} > 0`)
        .orderBy(desc(userWallets.balance))
        .limit(200);
      return res.json({ wallets });
    } catch (err) {
      console.error("Admin wallets error:", err);
      return res.status(500).json({ message: "Failed to fetch wallets" });
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
      
      await logAdminActivity({
        action: status === "approved" ? "approve_withdrawal" : "reject_withdrawal",
        targetType: "withdrawal",
        targetId: String(id),
        details: { stakeId: existing.stakeId, amount: existing.amount, admin_notes },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });

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
    username: z.string().min(1),
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
      const { username, password } = adminLoginSchema.parse(req.body);
      
      // Fetch admin credentials from database
      const [adminCreds] = await db.select().from(adminCredentials).limit(1);
      
      if (!adminCreds) {
        // No admin credentials set up yet - fall back to env var for initial setup
        const envPassword = process.env.ADMIN_PASSWORD;
        if (!envPassword) {
          return res.status(500).json({ message: "Admin credentials not configured. Set ADMIN_PASSWORD environment variable." });
        }
        // Log password length for debugging (remove after fixing)
        console.log(`[Admin Login] ADMIN_PASSWORD length: ${envPassword.length}`);
        // For initial setup, username must be "Lukerewards" (case-insensitive)
        if (username.toLowerCase() !== "lukerewards") {
          logSecurityEvent({
            type: "auth_failure",
            ipHash,
            details: "Invalid admin username attempt (initial setup)",
          });
          return res.status(401).json({ message: "Invalid credentials" });
        }
        // Check env password with timing-safe comparison
        const passwordBuffer = Buffer.from(password);
        const envPasswordBuffer = Buffer.from(envPassword);
        if (passwordBuffer.length !== envPasswordBuffer.length || 
            !crypto.timingSafeEqual(passwordBuffer, envPasswordBuffer)) {
          logSecurityEvent({
            type: "auth_failure",
            ipHash,
            details: "Invalid admin password attempt (initial setup)",
          });
          return res.status(401).json({ message: "Invalid credentials" });
        }
        // Use transaction to prevent race conditions during initial setup
        try {
          // Double-check no credentials exist (race condition protection)
          const [existingCreds] = await db.select().from(adminCredentials).limit(1);
          if (existingCreds) {
            // Another request already created credentials, validate against those instead
            const storedUsername = decrypt(existingCreds.usernameEncrypted);
            if (username.toLowerCase() !== storedUsername.toLowerCase()) {
              return res.status(401).json({ message: "Invalid credentials" });
            }
            const isValid = await bcrypt.compare(password, existingCreds.passwordHash);
            if (!isValid) {
              return res.status(401).json({ message: "Invalid credentials" });
            }
          } else {
            // Create admin credentials in database for future logins
            const usernameEncrypted = encrypt("Lukerewards");
            const passwordHash = await bcrypt.hash(envPassword, 12);
            await db.insert(adminCredentials).values({
              usernameEncrypted,
              passwordHash,
            });
            console.log("[Admin] Initial credentials stored in database (env var can now be removed)");
            logSecurityEvent({
              type: "auth_success",
              ipHash,
              details: "Admin credentials initialized in database",
            });
          }
        } catch (insertErr: any) {
          // Handle unique constraint violation (another concurrent request won)
          if (insertErr.code === "23505") {
            console.log("[Admin] Credentials already exist (concurrent creation)");
          } else {
            throw insertErr;
          }
        }
      } else {
        // Validate against database credentials
        const storedUsername = decrypt(adminCreds.usernameEncrypted);
        
        // Case-insensitive username comparison
        if (username.toLowerCase() !== storedUsername.toLowerCase()) {
          logSecurityEvent({
            type: "auth_failure",
            ipHash,
            details: "Invalid admin username attempt",
          });
          return res.status(401).json({ message: "Invalid credentials" });
        }
        
        // Validate password with bcrypt
        const isPasswordValid = await bcrypt.compare(password, adminCreds.passwordHash);
        if (!isPasswordValid) {
          logSecurityEvent({
            type: "auth_failure",
            ipHash,
            details: "Invalid admin password attempt",
          });
          return res.status(401).json({ message: "Invalid credentials" });
        }
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
      
      // Log admin activity
      await logAdminActivity({
        action: "login",
        targetType: "session",
        ipHash,
        details: { method: "password" },
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
      
      // Log admin activity
      await logAdminActivity({
        action: "logout",
        targetType: "session",
        ipHash,
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
      
      await logAdminActivity({
        action: "refresh_cache",
        targetType: "cache",
        details: { rowCount: result.rowCount },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
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
    }).from(users).where(isNull(users.deletedAt)).orderBy(users.createdAt);
    
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

  // Update user profile (admin)
  app.patch("/api/admin/users/:userId", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const { userId } = req.params;
    const updateSchema = z.object({
      stakePlatform: z.enum(["us", "com"]).optional(),
      stakeUsername: z.string().min(1).optional(),
    });
    
    try {
      const data = updateSchema.parse(req.body);
      
      if (Object.keys(data).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      
      const [existingUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!existingUser || existingUser.deletedAt) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const updateFields: Record<string, any> = { updatedAt: new Date() };
      if (data.stakePlatform) updateFields.stakePlatform = data.stakePlatform;
      if (data.stakeUsername) updateFields.stakeUsername = data.stakeUsername.toLowerCase();
      
      await db.update(users).set(updateFields).where(eq(users.id, userId));
      
      await logAdminActivity({
        action: "update_user_profile",
        targetType: "user",
        targetId: userId,
        details: { 
          username: existingUser.username,
          changes: data 
        },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
      return res.json({ success: true, message: "User updated successfully" });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: err.errors });
      }
      return res.status(500).json({ message: err.message || "Failed to update user" });
    }
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
      
      await logAdminActivity({
        action: "flag_user",
        targetType: "user",
        targetId: stakeId,
        details: { isBlacklisted: data.isBlacklisted, isAllowlisted: data.isAllowlisted, isDisputed: data.isDisputed },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
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
    
    await logAdminActivity({
      action: "unflag_user",
      targetType: "user",
      targetId: stakeId,
      ipHash: hashForLogging(getClientIpForSecurity(req)),
    });
    
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
      
      await logAdminActivity({
        action: "update_wager_override",
        targetType: "user",
        targetId: normalizedStakeId,
        details: { lifetimeWagered, yearToDateWagered, note },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
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
    
    await logAdminActivity({
      action: "delete_wager_override",
      targetType: "user",
      targetId: stakeId,
      ipHash: hashForLogging(getClientIpForSecurity(req)),
    });
    
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
    let weeklyWagered: number | null = null;
    let platform: string | null = null;
    let usingOverride = false;
    
    if (override) {
      usingOverride = true;
      lifetimeWagered = override.lifetimeWagered;
      yearToDateWagered = override.yearToDateWagered;
      platform = "Override (Test Data)";
    } else {
      // NGR sheet = lifetime wagered + weekly wagered
      if (ngrData) {
        lifetimeWagered = ngrData.wageredAmount;
        weeklyWagered = ngrData.wageredWeekly ?? null;
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
      weeklyWagered,
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
      BONUS_EVENT_ACTIVE: { value: "false", description: "Bonus event is currently active" },
      BONUS_EVENT_MULTIPLIER: { value: "1.5", description: "Win odds multiplier during bonus event" },
      BONUS_EVENT_NAME: { value: "Bonus Event", description: "Name displayed for the bonus event" },
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
      
      await logAdminActivity({
        action: "update_toggle",
        targetType: "toggle",
        targetId: key,
        details: { value },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
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
      
      await logAdminActivity({
        action: "export_raffle",
        targetType: "export",
        details: { campaign: params.campaign, weekLabel: params.weekLabel, totalTickets, rowCount: entries.length },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
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
      const { confirm, includeUsers } = req.body;
      if (confirm !== "RESET_ALL_DATA") {
        return res.status(400).json({ 
          message: "Confirmation required. Send { confirm: 'RESET_ALL_DATA' } to proceed." 
        });
      }
      
      // Clear spin/wallet data
      await db.delete(spinLogs);
      await db.delete(walletTransactions);
      await db.delete(userSpinBalances);
      await db.delete(userWallets);
      await db.delete(withdrawalRequests);
      await db.delete(userState);
      await db.delete(payouts);
      await db.delete(rateLimitLogs);
      await db.delete(guaranteedWins);
      
      const tablesList = [
        "spin_logs", "wallet_transactions", "user_spin_balances", 
        "user_wallets", "withdrawal_requests", "user_state",
        "payouts", "rate_limit_logs", "guaranteed_wins"
      ];
      
      // If includeUsers is true, also delete all users and related data
      if (includeUsers === true) {
        await db.delete(verificationRequests);
        await db.delete(userFlags);
        await db.delete(sessions);
        await db.delete(users);
        tablesList.push("verification_requests", "user_flags", "sessions", "users");
        
        await logAdminActivity({
          action: "refresh_cache",
          targetType: "cache",
          details: { type: "full_reset", includeUsers: true, tablesCleared: tablesList },
          ipHash: hashForLogging(getClientIpForSecurity(req)),
        });
        
        return res.json({ 
          message: "FULL RESET COMPLETE: All users, spins, and data have been deleted.",
          tables_cleared: tablesList
        });
      }
      
      return res.json({ 
        message: "All user data has been reset successfully.",
        tables_cleared: tablesList
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
      
      await logAdminActivity({
        action: status === "approved" ? "verify_user" : "reject_user",
        targetType: "user",
        targetId: result.userId,
        details: { stakeUsername: result.stakeUsername, admin_notes },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
      // Send verification email if approved
      if (status === "approved") {
        try {
          const [user] = await db.select().from(users).where(eq(users.id, result.userId));
          if (user && user.email) {
            const decryptedEmail = decrypt(user.email);
            if (decryptedEmail) {
              const emailResult = await sendVerificationApprovedEmail(decryptedEmail, user.username);
              console.log("[Verification] Email sent:", emailResult.success ? "success" : emailResult.error);
            }
          }
        } catch (emailErr) {
          console.error("[Verification] Failed to send verification email:", emailErr);
        }
      }
      
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

  // Admin: Grant free spins to user
  app.post("/api/admin/grant-spins", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const { stakeUsername, tier, amount } = req.body;
      
      if (!stakeUsername || !tier || !amount) {
        return res.status(400).json({ message: "stakeUsername, tier, and amount are required" });
      }
      
      if (!["bronze", "silver", "gold"].includes(tier)) {
        return res.status(400).json({ message: "Tier must be bronze, silver, or gold" });
      }
      
      const spinAmount = parseInt(amount, 10);
      if (isNaN(spinAmount) || spinAmount <= 0 || spinAmount > 1000) {
        return res.status(400).json({ message: "Amount must be between 1 and 1000" });
      }
      
      const stakeId = stakeUsername.toLowerCase();
      
      // Check if user exists in system
      const [user] = await db.select().from(users).where(eq(users.stakeUsername, stakeId));
      if (!user) {
        return res.status(404).json({ message: "User not found with that Stake username" });
      }
      
      // Get current balance for this tier
      const [existing] = await db.select().from(userSpinBalances)
        .where(and(
          eq(userSpinBalances.stakeId, stakeId),
          eq(userSpinBalances.tier, tier)
        ));
      
      if (existing) {
        // Update existing balance
        await db.update(userSpinBalances)
          .set({ 
            balance: existing.balance + spinAmount
          })
          .where(eq(userSpinBalances.id, existing.id));
      } else {
        // Create new balance record
        await db.insert(userSpinBalances).values({
          stakeId,
          tier,
          balance: spinAmount,
        });
      }
      
      // Log the action
      await logAdminActivity({
        action: "grant_spins",
        targetType: "user",
        targetId: user.id,
        details: { 
          stakeUsername: stakeId,
          tier,
          amount: spinAmount,
        },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
      console.log(`[Admin] Granted ${spinAmount} ${tier} spins to ${stakeId}`);
      
      // Get updated balances
      const newBalances = await getSpinBalances(stakeId);
      
      return res.json({ 
        success: true, 
        message: `Granted ${spinAmount} ${tier} spin${spinAmount > 1 ? 's' : ''} to ${stakeId}`,
        spinBalances: newBalances
      });
    } catch (err) {
      console.error("Admin grant spins error:", err);
      return res.status(500).json({ message: "Failed to grant spins" });
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
      
      await logAdminActivity({
        action: status === "verified" ? "verify_user" : "reject_user",
        targetType: "user",
        targetId: userId,
        details: { username: user.username, previousStatus: user.verificationStatus, newStatus: status },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
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
      
      await logAdminActivity({
        action: "delete_user",
        targetType: "user",
        targetId: userId,
        details: { username: user.username, stakeUsername: user.stakeUsername },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
      console.log(`[Admin] Deleted user ${user.username} (stake: ${user.stakeUsername || 'N/A'})`);
      return res.json({ success: true, username: user.username });
    } catch (err) {
      console.error("Admin delete user error:", err);
      console.error("Delete user params:", { userId: req.params.userId });
      return res.status(500).json({ message: "Failed to delete user", error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  // =================== PASSWORD RESET REQUESTS ===================
  app.get("/api/admin/password-reset-requests", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      
      // Get password reset requests with user info
      const requests = await db.select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        createdAt: passwordResetTokens.createdAt,
        expiresAt: passwordResetTokens.expiresAt,
        usedAt: passwordResetTokens.usedAt,
        ipHash: passwordResetTokens.requestIpHash,
        username: users.username,
        email: users.email,
      })
      .from(passwordResetTokens)
      .leftJoin(users, eq(passwordResetTokens.userId, users.id))
      .orderBy(desc(passwordResetTokens.createdAt))
      .limit(limit);
      
      return res.json({ 
        requests: requests.map(r => ({
          id: r.id,
          userId: r.userId,
          username: r.username || "Unknown",
          email: r.email || "No email",
          createdAt: r.createdAt?.toISOString(),
          expiresAt: r.expiresAt?.toISOString(),
          usedAt: r.usedAt?.toISOString() || null,
          status: r.usedAt ? "used" : (r.expiresAt && new Date(r.expiresAt) < new Date() ? "expired" : "pending"),
          ipHash: r.ipHash,
        }))
      });
    } catch (err) {
      console.error("Admin password reset requests error:", err);
      return res.status(500).json({ message: "Failed to fetch password reset requests" });
    }
  });

  // =================== ADMIN ACTIVITY LOGS ===================
  app.get("/api/admin/activity-logs", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    
    const logs = await getAdminActivityLogs(limit, offset);
    const total = await getAdminActivityLogCount();
    
    return res.json({ 
      logs: logs.map(log => ({
        ...log,
        details: log.details ? JSON.parse(log.details) : null,
      })),
      total,
      limit,
      offset,
    });
  });

  // =================== BACKUP STATUS & MANAGEMENT ===================
  app.get("/api/admin/backup-status", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const status = await getBackupStatus();
    const files = await listBackupFiles();
    
    return res.json({
      ...status,
      files: files.slice(0, 20),
    });
  });

  app.post("/api/admin/backup/create", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const result = await createBackup(true);
    
    await logAdminActivity({
      action: "manual_backup",
      targetType: "backup",
      details: { success: result.success, filename: result.filename, error: result.error },
      ipHash: hashForLogging(getClientIpForSecurity(req)),
    });
    
    return res.json(result);
  });

  // Download a specific backup file
  app.get("/api/admin/backup/download/:filename", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const { filename } = req.params;
    
    // Validate filename format to prevent path traversal
    if (!filename.match(/^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sql$/)) {
      return res.status(400).json({ message: "Invalid backup filename" });
    }
    
    const backupPath = path.join(process.cwd(), "backups", filename);
    
    try {
      // Check if file exists
      if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ message: "Backup file not found" });
      }
      
      await logAdminActivity({
        action: "download_backup",
        targetType: "backup",
        details: { filename },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
      res.setHeader("Content-Type", "application/sql");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      
      const fileContent = fs.readFileSync(backupPath, "utf-8");
      return res.send(fileContent);
    } catch (err) {
      return res.status(500).json({ message: "Failed to download backup" });
    }
  });

  // =================== SETUP DEFAULT REFERRALS ===================
  app.post("/api/admin/setup-referrals", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const DEFAULT_REFERRER = "ergysonuzi";
    
    try {
      // Check if default referrer exists
      const [defaultReferrer] = await db.select()
        .from(users)
        .where(sql`LOWER(${users.username}) = ${DEFAULT_REFERRER.toLowerCase()}`);
      
      if (!defaultReferrer) {
        return res.status(400).json({ 
          success: false,
          message: `Default referrer "${DEFAULT_REFERRER}" does not exist. Please create this account first.`,
          created: 0
        });
      }
      
      // Find users without referrals (excluding the default referrer themselves)
      const usersWithoutReferrals = await db.select({ id: users.id, username: users.username })
        .from(users)
        .leftJoin(referrals, eq(users.id, referrals.referredUserId))
        .where(and(
          isNull(referrals.id),
          sql`LOWER(${users.username}) != ${DEFAULT_REFERRER.toLowerCase()}`
        ));
      
      if (usersWithoutReferrals.length === 0) {
        return res.json({ 
          success: true,
          message: "All users already have referrers assigned.",
          created: 0
        });
      }
      
      // Create referral records for users without referrers
      let created = 0;
      for (const user of usersWithoutReferrals) {
        try {
          await db.insert(referrals).values({
            referrerUserId: defaultReferrer.id,
            referredUserId: user.id,
            referralCode: DEFAULT_REFERRER.toLowerCase(),
            status: "pending",
            createdAt: new Date(),
          });
          created++;
        } catch (err) {
          // Skip duplicates
          console.log(`Skipping duplicate referral for user ${user.username}`);
        }
      }
      
      await logAdminActivity({
        action: "setup_referrals",
        targetType: "referral",
        details: { 
          defaultReferrer: DEFAULT_REFERRER,
          usersAssigned: created,
          totalWithoutReferrals: usersWithoutReferrals.length
        },
        ipHash: hashForLogging(getClientIpForSecurity(req)),
      });
      
      return res.json({ 
        success: true,
        message: `Successfully assigned ${created} users to ${DEFAULT_REFERRER}.`,
        created
      });
    } catch (err) {
      console.error("Setup referrals error:", err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ 
        success: false,
        message: `Failed to setup referrals: ${errorMessage}`,
        created: 0
      });
    }
  });

  return httpServer;
}
