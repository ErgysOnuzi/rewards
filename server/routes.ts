import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { 
  lookupRequestSchema, spinRequestSchema, convertSpinsRequestSchema, 
  purchaseSpinsRequestSchema, withdrawRequestSchema, processWithdrawalSchema,
  spinLogs, userWallets, userSpinBalances, 
  withdrawalRequests, walletTransactions,
  userFlags, adminSessions, exportLogs, featureToggles, payouts, rateLimitLogs, userState,
  CASE_PRIZES, selectCasePrize, validatePrizeProbabilities, type CasePrize, type SpinBalances
} from "@shared/schema";
import type { 
  LookupResponse, SpinResponse, ErrorResponse,
  ConvertSpinsResponse, PurchaseSpinsResponse, WithdrawResponse
} from "@shared/schema";
import { getWagerRow, calculateTickets, getCacheStatus, refreshCache, getAllWagerData, computeDataHash } from "./lib/sheets";
import { hashIp } from "./lib/hash";
import { isRateLimited, isStakeIdRateLimited } from "./lib/rateLimit";
import { config } from "./lib/config";
import { ZodError, z } from "zod";
import { db } from "./db";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import crypto from "crypto";


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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.post("/api/lookup", async (req: Request, res: Response) => {
    try {
      const parsed = lookupRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();

      const wagerRow = await getWagerRow(stakeId);
      if (!wagerRow) {
        return res.status(404).json({ message: "Stake ID not found." } as ErrorResponse);
      }

      const ticketsTotal = calculateTickets(wagerRow.wageredAmount);
      const ticketsUsed = await countSpinsForStakeId(stakeId);
      const ticketsRemaining = Math.max(0, ticketsTotal - ticketsUsed);
      
      const walletBalance = await getWalletBalance(stakeId);
      const spinBalances = await getSpinBalances(stakeId);
      const pendingWithdrawals = await getPendingWithdrawals(stakeId);

      const response: LookupResponse = {
        stake_id: wagerRow.stakeId,
        period_label: wagerRow.periodLabel,
        wagered_amount: wagerRow.wageredAmount,
        tickets_total: ticketsTotal,
        tickets_used: ticketsUsed,
        tickets_remaining: ticketsRemaining,
        wallet_balance: walletBalance,
        spin_balances: spinBalances,
        pending_withdrawals: pendingWithdrawals,
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
      const clientIp = getClientIp(req);
      const ipHash = hashIp(clientIp);

      if (isRateLimited(ipHash)) {
        return res.status(429).json({ message: "Too many spin attempts. Try again later." } as ErrorResponse);
      }

      const parsed = spinRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();

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

      const wagerRow = await getWagerRow(stakeId);
      if (!wagerRow) {
        return res.status(404).json({ message: "Stake ID not found." } as ErrorResponse);
      }

      // Calculate tickets from wager amount (1 ticket per $1000 wagered)
      const ticketsTotal = calculateTickets(wagerRow.wageredAmount);
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

      // Log spin to database
      await db.insert(spinLogs).values({
        stakeId: wagerRow.stakeId,
        wageredAmount: wagerRow.wageredAmount,
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
        stake_id: wagerRow.stakeId,
        wagered_amount: wagerRow.wageredAmount,
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
      const parsed = lookupRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();
      const ipHash = hashIp(req.ip || "unknown");

      // Check blacklist - fail closed on error
      const blacklistCheck = await checkUserBlacklist(stakeId);
      if (blacklistCheck.error) {
        return res.status(500).json({ message: blacklistCheck.error } as ErrorResponse);
      }
      if (blacklistCheck.blacklisted) {
        return res.status(403).json({ message: "Account suspended. Contact support." } as ErrorResponse);
      }

      // Check if user exists in sheet
      const wagerRow = await getWagerRow(stakeId);
      if (!wagerRow) {
        return res.status(404).json({ message: "Stake ID not found in wagering data" } as ErrorResponse);
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

      // Use case prize system for bonus spin
      const prize = selectCasePrize(CASE_PRIZES);
      const isWin = prize.value > 0;

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
        wageredAmount: wagerRow.wageredAmount,
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
      const parsed = lookupRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();

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


  // Request withdrawal to Stake account
  app.post("/api/wallet/withdraw", async (req: Request, res: Response) => {
    try {
      const parsed = withdrawRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();
      const amount = parsed.amount;

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

  // =================== ADMIN AUTHENTICATION ===================
  const adminLoginSchema = z.object({
    password: z.string().min(1),
  });

  app.post("/api/admin/login", async (req: Request, res: Response) => {
    try {
      const { password } = adminLoginSchema.parse(req.body);
      const adminPassword = process.env.ADMIN_PASSWORD;
      
      if (!adminPassword) {
        return res.status(500).json({ message: "Admin password not configured" });
      }
      if (password !== adminPassword) {
        return res.status(401).json({ message: "Invalid password" });
      }

      const sessionToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await db.insert(adminSessions).values({ sessionToken, expiresAt });
      
      res.cookie("admin_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        expires: expiresAt,
      });

      return res.json({ success: true });
    } catch (err: any) {
      console.error("Admin login error:", err);
      return res.status(500).json({ message: "Login failed", error: err?.message });
    }
  });

  app.post("/api/admin/logout", async (req: Request, res: Response) => {
    const sessionToken = req.cookies?.admin_session;
    if (sessionToken) {
      await db.delete(adminSessions).where(eq(adminSessions.sessionToken, sessionToken));
    }
    res.clearCookie("admin_session");
    return res.json({ success: true });
  });

  async function verifyAdminSession(req: Request): Promise<boolean> {
    const sessionToken = req.cookies?.admin_session;
    if (!sessionToken) return false;
    
    const [session] = await db.select().from(adminSessions)
      .where(and(eq(adminSessions.sessionToken, sessionToken), gte(adminSessions.expiresAt, new Date())));
    return !!session;
  }

  app.get("/api/admin/verify", async (req: Request, res: Response) => {
    const isValid = await verifyAdminSession(req);
    return res.json({ authenticated: isValid });
  });

  // Middleware helper
  async function requireAdmin(req: Request, res: Response): Promise<boolean> {
    const isValid = await verifyAdminSession(req);
    if (!isValid) {
      res.status(401).json({ message: "Admin authentication required" });
      return false;
    }
    return true;
  }

  // =================== DATA STATUS PANEL ===================
  app.get("/api/admin/data-status", async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    
    const cacheStatus = getCacheStatus();
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
      sheetId: config.googleSheetsId ? `...${config.googleSheetsId.slice(-8)}` : "Not configured",
      tabName: config.wagerSheetName,
      ...cacheStatus,
      duplicateCount: duplicates.length,
      duplicates: duplicates.slice(0, 20),
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
    
    // Get wager data from sheets
    const wagerRow = await getWagerRow(stakeId);
    const cacheStatus = getCacheStatus();
    
    // Get local stats from database
    const spins = await db.select().from(spinLogs).where(eq(spinLogs.stakeId, stakeId)).orderBy(desc(spinLogs.timestamp));
    const [wallet] = await db.select().from(userWallets).where(eq(userWallets.stakeId, stakeId));
    const spinBalances = await getSpinBalances(stakeId);
    const [flagData] = await db.select().from(userFlags).where(eq(userFlags.stakeId, stakeId));
    const transactions = await db.select().from(walletTransactions).where(eq(walletTransactions.stakeId, stakeId)).orderBy(desc(walletTransactions.createdAt)).limit(20);
    
    const winCount = spins.filter(s => s.result === "WIN").length;
    const lastSpin = spins[0];

    return res.json({
      found: !!wagerRow,
      wagerData: wagerRow,
      sheetLastUpdated: cacheStatus.lastFetchTime,
      computedTickets: wagerRow ? calculateTickets(wagerRow.wageredAmount) : 0,
      localStats: {
        totalSpins: spins.length,
        wins: winCount,
        lastSpinTime: lastSpin?.timestamp || null,
        walletBalance: wallet?.balance || 0,
        spinBalances,
      },
      flags: flagData || null,
      recentTransactions: transactions,
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
      
      // Top 10 by tickets
      const sorted = [...entries].filter(e => e.status === "ok").sort((a, b) => b.tickets - a.tickets);
      const top10 = sorted.slice(0, 10);
      
      // Stats
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

  return httpServer;
}
