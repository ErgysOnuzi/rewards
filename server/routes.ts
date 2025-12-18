import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { 
  lookupRequestSchema, spinRequestSchema, convertSpinsRequestSchema, 
  purchaseSpinsRequestSchema, withdrawRequestSchema, processWithdrawalSchema,
  demoUsers, spinLogs, guaranteedWins, userWallets, userSpinBalances, 
  withdrawalRequests, walletTransactions,
  TIER_CONFIG, CONVERSION_RATES, type SpinTier, type SpinBalances
} from "@shared/schema";
import type { 
  LookupResponse, SpinResponse, ErrorResponse, SpinLogRow,
  ConvertSpinsResponse, PurchaseSpinsResponse, WithdrawResponse
} from "@shared/schema";
import { getWagerRow, countSpinsForStakeId, appendSpinLogRow, calculateTickets, determineSpinResult } from "./lib/sheets";
import { hashIp } from "./lib/hash";
import { isRateLimited } from "./lib/rateLimit";
import { config, validateConfig } from "./lib/config";
import { ZodError } from "zod";
import { db } from "./db";
import { eq, desc, sql, and } from "drizzle-orm";

function isDemoMode(): boolean {
  const errors = validateConfig();
  return errors.length > 0;
}

// Seed default demo users if they don't exist
async function seedDemoData() {
  const defaultUsers = [
    { stakeId: "ergys", wageredAmount: 1000000, periodLabel: "December 2024" },
    { stakeId: "demo", wageredAmount: 5000, periodLabel: "December 2024" },
    { stakeId: "luke", wageredAmount: 20000, periodLabel: "December 2024" },
  ];
  
  const defaultWins = [
    { stakeId: "luke", spinNumber: 13 },
    { stakeId: "ergys", spinNumber: 2 },
  ];

  for (const user of defaultUsers) {
    const existing = await db.select().from(demoUsers).where(eq(demoUsers.stakeId, user.stakeId));
    if (existing.length === 0) {
      await db.insert(demoUsers).values(user);
    }
  }

  for (const win of defaultWins) {
    const existing = await db.select().from(guaranteedWins)
      .where(eq(guaranteedWins.stakeId, win.stakeId));
    if (!existing.some(w => w.spinNumber === win.spinNumber)) {
      await db.insert(guaranteedWins).values(win);
    }
  }
}

// Initialize on startup
seedDemoData().catch(console.error);

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

async function updateSpinBalance(stakeId: string, tier: SpinTier, delta: number): Promise<number> {
  const [existing] = await db.select().from(userSpinBalances)
    .where(and(eq(userSpinBalances.stakeId, stakeId), eq(userSpinBalances.tier, tier)));
  if (existing) {
    const newBalance = Math.max(0, existing.balance + delta);
    await db.update(userSpinBalances)
      .set({ balance: newBalance })
      .where(and(eq(userSpinBalances.stakeId, stakeId), eq(userSpinBalances.tier, tier)));
    return newBalance;
  } else if (delta > 0) {
    await db.insert(userSpinBalances).values({ stakeId, tier, balance: delta });
    return delta;
  }
  return 0;
}

async function getPendingWithdrawals(stakeId: string): Promise<number> {
  const result = await db.select({ sum: sql<number>`COALESCE(SUM(amount), 0)` })
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.stakeId, stakeId), eq(withdrawalRequests.status, "pending")));
  return Number(result[0]?.sum || 0);
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.post("/api/lookup", async (req: Request, res: Response) => {
    try {
      const parsed = lookupRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();

      // Demo mode when Google Sheets isn't configured
      if (isDemoMode()) {
        const [demoUser] = await db.select().from(demoUsers).where(eq(demoUsers.stakeId, stakeId));
        if (!demoUser) {
          return res.status(404).json({ message: "Stake ID not found. Try 'ergys', 'demo', or 'luke'." } as ErrorResponse);
        }
        const ticketsTotal = calculateTickets(demoUser.wageredAmount);
        const spinCount = await db.select({ count: sql<number>`count(*)` }).from(spinLogs).where(eq(spinLogs.stakeId, stakeId));
        const ticketsUsed = Number(spinCount[0]?.count || 0);
        const ticketsRemaining = Math.max(0, ticketsTotal - ticketsUsed);
        
        const walletBalance = await getWalletBalance(stakeId);
        const spinBalances = await getSpinBalances(stakeId);
        const pendingWithdrawals = await getPendingWithdrawals(stakeId);

        const response: LookupResponse = {
          stake_id: stakeId,
          period_label: demoUser.periodLabel,
          wagered_amount: demoUser.wageredAmount,
          tickets_total: ticketsTotal,
          tickets_used: ticketsUsed,
          tickets_remaining: ticketsRemaining,
          wallet_balance: walletBalance,
          spin_balances: spinBalances,
          pending_withdrawals: pendingWithdrawals,
        };
        return res.json(response);
      }

      const wagerRow = await getWagerRow(stakeId);
      if (!wagerRow) {
        return res.status(404).json({ message: "Stake ID not found in wager sheet." } as ErrorResponse);
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
      return res.status(500).json({ message: "Internal server error" } as ErrorResponse);
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
      const tier: SpinTier = parsed.tier || "bronze";

      // Demo mode when Google Sheets isn't configured
      if (isDemoMode()) {
        const [demoUser] = await db.select().from(demoUsers).where(eq(demoUsers.stakeId, stakeId));
        if (!demoUser) {
          return res.status(404).json({ message: "Stake ID not found. Try 'ergys', 'demo', or 'luke'." } as ErrorResponse);
        }

        // Check if user has purchased tier spins first
        const currentSpinBalances = await getSpinBalances(stakeId);
        const hasTierSpin = currentSpinBalances[tier] > 0;

        // For free spins (bronze only, from wager tickets)
        const ticketsTotal = calculateTickets(demoUser.wageredAmount);
        const spinCount = await db.select({ count: sql<number>`count(*)` }).from(spinLogs).where(eq(spinLogs.stakeId, stakeId));
        const ticketsUsedBefore = Number(spinCount[0]?.count || 0);
        const freeTicketsRemaining = ticketsTotal - ticketsUsedBefore;

        // Determine spin source
        let usePurchasedSpin = hasTierSpin;
        let useFreeTicket = !hasTierSpin && tier === "bronze" && freeTicketsRemaining > 0;

        if (!usePurchasedSpin && !useFreeTicket) {
          if (tier !== "bronze") {
            return res.status(403).json({ message: `No ${tier} spins available. Purchase or convert spins first.` } as ErrorResponse);
          }
          return res.status(403).json({ message: "No tickets remaining." } as ErrorResponse);
        }

        // Consume the spin
        let spinNumber = ticketsUsedBefore + 1;
        let ticketsUsedAfter = ticketsUsedBefore;
        let ticketsRemainingAfter = freeTicketsRemaining;

        if (usePurchasedSpin) {
          // Deduct from purchased spin balance
          await updateSpinBalance(stakeId, tier, -1);
        } else {
          // Use free ticket
          ticketsUsedAfter = ticketsUsedBefore + 1;
          ticketsRemainingAfter = ticketsTotal - ticketsUsedAfter;
        }

        // Check for guaranteed win (only for bronze free spins)
        const userGuaranteedWins = await db.select().from(guaranteedWins).where(eq(guaranteedWins.stakeId, stakeId));
        const isGuaranteedWin = !usePurchasedSpin && userGuaranteedWins.some(w => w.spinNumber === spinNumber);
        
        const result = isGuaranteedWin ? "WIN" : determineSpinResult(tier);
        const tierPrizeValue = TIER_CONFIG[tier].prizeValue;
        const prizeLabel = result === "WIN" ? `$${tierPrizeValue} Stake Tip` : "";
        const prizeValue = result === "WIN" ? tierPrizeValue : 0;

        // Log spin to database (only for free ticket spins)
        if (!usePurchasedSpin) {
          await db.insert(spinLogs).values({
            stakeId,
            wageredAmount: demoUser.wageredAmount,
            spinNumber,
            result,
            prizeLabel,
            prizeValue,
            ipHash,
          });
        }

        // Add winnings to wallet if won
        let walletBalance = await getWalletBalance(stakeId);
        if (result === "WIN") {
          walletBalance = await updateWalletBalance(stakeId, prizeValue);
          await db.insert(walletTransactions).values({
            stakeId,
            type: "win",
            amount: prizeValue,
            tier,
            description: `Won ${tier} spin: ${prizeLabel}`,
          });
        }

        const spinBalances = await getSpinBalances(stakeId);

        const response: SpinResponse = {
          stake_id: stakeId,
          wagered_amount: demoUser.wageredAmount,
          tickets_total: ticketsTotal,
          tickets_used_before: ticketsUsedBefore,
          tickets_used_after: ticketsUsedAfter,
          tickets_remaining_after: ticketsRemainingAfter,
          result,
          prize_label: prizeLabel,
          prize_value: prizeValue,
          tier,
          wallet_balance: walletBalance,
          spin_balances: spinBalances,
        };
        return res.json(response);
      }

      const wagerRow = await getWagerRow(stakeId);
      if (!wagerRow) {
        return res.status(404).json({ message: "Stake ID not found in wager sheet." } as ErrorResponse);
      }

      const ticketsTotal = calculateTickets(wagerRow.wageredAmount);
      const ticketsUsedBefore = await countSpinsForStakeId(stakeId);
      const ticketsRemaining = ticketsTotal - ticketsUsedBefore;

      if (ticketsRemaining <= 0) {
        return res.status(403).json({ message: "No tickets remaining." } as ErrorResponse);
      }

      const result = determineSpinResult(tier);
      const tierPrizeValue = TIER_CONFIG[tier].prizeValue;
      const prizeLabel = result === "WIN" ? `$${tierPrizeValue} Stake Tip` : "";
      const prizeValue = result === "WIN" ? tierPrizeValue : 0;
      const ticketsUsedAfter = ticketsUsedBefore + 1;
      const ticketsRemainingAfter = ticketsTotal - ticketsUsedAfter;

      const logRow: SpinLogRow = {
        timestampIso: new Date().toISOString(),
        stakeId: wagerRow.stakeId,
        wageredAmount: wagerRow.wageredAmount,
        ticketsTotal,
        ticketsUsedBefore,
        ticketsUsedAfter,
        ticketsRemainingAfter,
        result,
        winProbability: config.winProbability,
        prizeLabel,
        requestId: randomUUID(),
        ipHash,
        userAgent: req.headers["user-agent"] || "unknown",
      };

      await appendSpinLogRow(logRow);

      // Add winnings to wallet if won
      let walletBalance = await getWalletBalance(stakeId);
      if (result === "WIN") {
        walletBalance = await updateWalletBalance(stakeId, prizeValue);
        await db.insert(walletTransactions).values({
          stakeId,
          type: "win",
          amount: prizeValue,
          tier,
          description: `Won ${tier} spin: ${prizeLabel}`,
        });
      }

      const spinBalances = await getSpinBalances(stakeId);

      const response: SpinResponse = {
        stake_id: wagerRow.stakeId,
        wagered_amount: wagerRow.wageredAmount,
        tickets_total: ticketsTotal,
        tickets_used_before: ticketsUsedBefore,
        tickets_used_after: ticketsUsedAfter,
        tickets_remaining_after: ticketsRemainingAfter,
        result,
        prize_label: prizeLabel,
        prize_value: prizeValue,
        tier,
        wallet_balance: walletBalance,
        spin_balances: spinBalances,
      };

      return res.json(response);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Spin error:", err);
      return res.status(500).json({ message: "Internal server error" } as ErrorResponse);
    }
  });

  app.get("/api/admin/logs", async (_req: Request, res: Response) => {
    try {
      // Get logs from database (works in both demo and sheets mode)
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
        mode: isDemoMode() ? "demo" : "sheets",
        logs: formattedLogs,
        totalSpins: Number(totalCount[0]?.count || 0),
        totalWins: Number(winCount[0]?.count || 0),
      });
    } catch (err) {
      console.error("Admin logs error:", err);
      return res.status(500).json({ message: "Failed to fetch logs" });
    }
  });

  // Convert spins between tiers (5 bronze = 1 silver, 10 silver = 1 gold)
  app.post("/api/spins/convert", async (req: Request, res: Response) => {
    try {
      const parsed = convertSpinsRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();
      const fromTier = parsed.from_tier as SpinTier;
      const toTier = parsed.to_tier as SpinTier;
      const quantity = parsed.quantity;

      // Validate conversion path
      if (fromTier === "bronze" && toTier !== "silver") {
        return res.status(400).json({ message: "Bronze can only convert to Silver" } as ErrorResponse);
      }
      if (fromTier === "silver" && toTier !== "gold") {
        return res.status(400).json({ message: "Silver can only convert to Gold" } as ErrorResponse);
      }

      const conversionRate = fromTier === "bronze" ? CONVERSION_RATES.bronze_to_silver : CONVERSION_RATES.silver_to_gold;
      const requiredSpins = quantity * conversionRate;

      // Check balance
      const currentBalances = await getSpinBalances(stakeId);
      if (currentBalances[fromTier] < requiredSpins) {
        return res.status(400).json({ 
          message: `Not enough ${fromTier} spins. Need ${requiredSpins}, have ${currentBalances[fromTier]}` 
        } as ErrorResponse);
      }

      // Perform conversion
      await updateSpinBalance(stakeId, fromTier, -requiredSpins);
      await updateSpinBalance(stakeId, toTier, quantity);

      const newBalances = await getSpinBalances(stakeId);

      const response: ConvertSpinsResponse = {
        success: true,
        from_tier: fromTier,
        to_tier: toTier,
        quantity_converted: quantity,
        spin_balances: newBalances,
      };

      return res.json(response);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Convert error:", err);
      return res.status(500).json({ message: "Internal server error" } as ErrorResponse);
    }
  });

  // Purchase spins with wallet balance
  app.post("/api/spins/purchase", async (req: Request, res: Response) => {
    try {
      const parsed = purchaseSpinsRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();
      const tier = parsed.tier as SpinTier;
      const quantity = parsed.quantity;

      const cost = TIER_CONFIG[tier].cost * quantity;
      const walletBalance = await getWalletBalance(stakeId);

      if (walletBalance < cost) {
        return res.status(400).json({ 
          message: `Not enough funds. Need $${cost}, have $${walletBalance}` 
        } as ErrorResponse);
      }

      // Deduct from wallet and add spins
      const newWalletBalance = await updateWalletBalance(stakeId, -cost);
      await updateSpinBalance(stakeId, tier, quantity);
      
      // Log transaction
      await db.insert(walletTransactions).values({
        stakeId,
        type: "purchase",
        amount: -cost,
        tier,
        description: `Purchased ${quantity} ${tier} spin(s) for $${cost}`,
      });

      const newBalances = await getSpinBalances(stakeId);

      const response: PurchaseSpinsResponse = {
        success: true,
        tier,
        quantity,
        cost,
        wallet_balance: newWalletBalance,
        spin_balances: newBalances,
      };

      return res.json(response);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Purchase error:", err);
      return res.status(500).json({ message: "Internal server error" } as ErrorResponse);
    }
  });

  // Request withdrawal to Stake account
  app.post("/api/wallet/withdraw", async (req: Request, res: Response) => {
    try {
      const parsed = withdrawRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();
      const amount = parsed.amount;

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
  app.get("/api/admin/withdrawals", async (_req: Request, res: Response) => {
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
    const configErrors = validateConfig();
    if (configErrors.length > 0) {
      return res.status(500).json({
        configured: false,
        errors: configErrors,
        message: "Please configure the required environment variables in Replit Secrets.",
      });
    }
    return res.json({
      configured: true,
      siteName: config.siteName,
      prizeLabel: config.prizeLabel,
      tierConfig: TIER_CONFIG,
      conversionRates: CONVERSION_RATES,
    });
  });

  return httpServer;
}
